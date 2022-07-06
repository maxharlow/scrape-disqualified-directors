import FSExtra from 'fs-extra'
import Axios from 'axios'
import HTMLToText from 'html-to-text'
import * as Cheerio from 'cheerio'
import Scramjet from 'scramjet'
import IconvLite from 'iconv-lite'

async function cases() {
    const response = await Axios('http://www.insolvencydirect.bis.gov.uk/IESdatabase/viewdirectorsummary-new.asp')
    const document = Cheerio.load(response.data)
    const urls = document('[href^=viewdisqualdetail]').get().map(element => {
        return Cheerio.load(element)('*').attr('href').split('=').pop()
    })
    return [...new Set(urls)].filter(x => x)
}

async function detail(caseNumber) {
    console.log(`Fetching case ${caseNumber}...`)
    const response = await Axios({
        url: `https://www.insolvencydirect.bis.gov.uk/IESdatabase/viewdisqualdetail.asp?courtnumber=${caseNumber}`,
        responseType: 'arraybuffer',
        transformResponse: [
            data => IconvLite.decode(data, 'windows-1252')
        ]
    })
    const document = Cheerio.load(response.data)
    const blocks = document('table:nth-of-type(2) td').html().split(/Case details .+/i)[1].split(/<hr\s*\/?>/i)[0].split(/<br\s*\/?>/i)
    return blocks.filter(block => block.includes('Name')).map(block => {
        const detailsText = HTMLToText.convert(Cheerio.load(block).html(), { wordwrap: false })
        const details = detailsText.replace(/\s*\n\s*/g, '\n').replace(/[\xA0 ]+/g, ' ').trim().split('\n').map(line => {
            return line.includes(':') ? line.slice(line.indexOf(': ') + 2) : line
        })
        return {
            caseNumber,
            companyName: details[1],
            personName: details[0],
            dateOfBirth: details[2] === '/ /' ? null : details[2].replace(/ \/ /g, '/'),
            dateOrderStarts: details[3].replace(/ \/ /g, '/'),
            disqualificationLength: details[4],
            // croNumber: details[5],
            lastKnownAddress: details[6] === ', , , , ,' ? null : details[6].replace(/(, *)+/g, ', '),
            informationCorrectAsOf: details.pop().replace('This information is correct as at ', '').replace(/ \/ /g, '/'),
            conduct: details[7]
        }
    })
}

function run() {
    Scramjet.DataStream.from(cases())
        .setOptions({ maxParallel: 1 })
        .flatMap(detail)
        .CSVStringify()
        .pipe(FSExtra.createWriteStream('disqualified-directors.csv'))
}

run()
