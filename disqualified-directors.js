const highland = require('highland')
const request = require('request')
const iconv = require('iconv-lite')
const cheerio = require('cheerio')
const fs = require('fs')
const csvWriter = require('csv-write-stream')
const tls = require('tls')

tls.DEFAULT_CIPHERS = tls.DEFAULT_CIPHERS.replace('!RC4', 'RC4') // enable insecure rc4 cipher

const http = highland.wrapCallback((location, callback) => {
    request.defaults({ encoding: null })(location, (error, response) => {
        const failure = error ? error : (response.statusCode >= 400) ? new Error(response.statusCode) : null
        response.body = iconv.decode(new Buffer(response.body), 'windows-1252')
        if (location.ignoreErrors) callback(null, response)
        else callback(failure, response)
    })
})

const location = 'http://www.insolvencydirect.bis.gov.uk/IESdatabase/viewdirectorsummary-new.asp'

function listing(response) {
    const document = cheerio.load(response.body)
    const listDetails = document('font:not([size])').filter((_, e) => cheerio(e).find('b').length == 4)
    const listLink = document('a[href^=viewdisqualdetail]')
    if (listDetails.length !== listLink.length) throw new Error('Details and link selectors are not working (' + listDetails.length + '/' + listLink.length + ')')
    return listLink.get().map((entry, i) => {
        return {
            name: listDetails.eq(i).contents().eq(1).text().replace(/\u00A0/g, ' ').replace(/ +/g, ' ').trim(),
            company: listDetails.eq(i).find('p:nth-of-type(1)').text().replace('Company Name:', '').replace(/\/r\/n/g, ' ').trim(),
            disqualificationLength: listDetails.eq(i).find('p:nth-of-type(2)').text().replace('Disqualification Length:', '').replace(/\u00A0/g, ' ').replace(/ +/g, ' ').trim(),
            location: 'https://www.insolvencydirect.bis.gov.uk/IESdatabase/' + cheerio(entry).attr('href')
            
        }
    })
}

function detailLookup(entry) {
    return {
        url: entry.location,
        entry: entry,
        ignoreErrors: true
    }
}

function detail(response) {
    const entry = response.request.entry
    if (response.statusCode >= 404) return entry
    const document = cheerio.load(response.body)
    const name = document('td p:nth-of-type(1)').text().replace('Name:', '').replace(/\u00A0/g, ' ').replace(/ +/g, ' ').trim()
    if (entry.name !== name) {
        console.log('Ignoring details: entry "' + entry.name + '" links to page named "' + name + '"')
        return entry
    }
    entry['company'] = document('td p:nth-of-type(2)').text().replace('Name:', '').replace(/\/r\/n/g, ' ').trim()
    entry['birthDate'] = document('td p:nth-of-type(3)').text().replace('Date of Birth:', '').trim()
    entry['orderStartDate'] = document('td p:nth-of-type(4)').text().replace('Date Order Starts:', '').trim()
    entry['disqualificationLength'] = document('td p:nth-of-type(5)').text().replace('Disqualification Length:', '').replace(/\u00A0/g, ' ').replace(/ +/g, ' ').trim()
    entry['croNumber'] = document('td p:nth-of-type(6)').text().replace('CRO Number:', '').trim()
    entry['lastKnownAddress'] = document('td p:nth-of-type(7)').text().replace('Last Known Address:', '').trim()
    entry['conduct'] = document('td p:nth-of-type(8)').text().replace('Conduct:', '').replace(/\r/g, '').replace(/\u00A0/g, ' ').replace(/ +/g, ' ').trim()
    entry['lastUpdated'] = document('td p:nth-of-type(9)').text().replace('This information is correct as at', '').trim()
    return entry
}

highland([location])
    .flatMap(http)
    .flatMap(listing)
    .map(detailLookup)
    .flatMap(http)
    .map(detail)
    .errors(e => console.log(e.stack))
    .through(csvWriter())
    .pipe(fs.createWriteStream('disqualified-directors.csv'))
