'use strict'
const url = require('url')
const pkg = require('./package.json')
const {send} = require('micro')
const origin = process.env.ALLOW_ORIGIN
const insecure_origins = (process.env.INSECURE_HTTP_ORIGINS || '').split(',')
const middleware = require('./middleware.js')({ origin, insecure_origins })

async function service (req, res) {
  middleware(req, res, () => {
    let u = url.parse(req.url, true)

    if (u.pathname === '/') {
      res.setHeader('content-type', 'text/html')
      let html = `<!DOCTYPE html>
      <html>
        <title>git.tabsets.net</title>
        <h1>git.tabsets.net</h1>
        <p>runing...</p>
      </html>
      `
      return send(res, 400, html)
    }

    // Don't waste my precious bandwidth
    return send(res, 403, '')
  })
}

module.exports = service
