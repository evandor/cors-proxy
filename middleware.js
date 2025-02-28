'use strict'
const url = require('url')
const {send} = require('micro')
const microCors = require('micro-cors')
const fetch = require('node-fetch')
const { initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore, doc, getDoc} = require("firebase-admin/firestore");

const { Logtail } = require("@logtail/node");
const logtail = new Logtail("g2dNS5TgpG16GSeXLspPDUPk");

const firebaseApp = initializeApp({
  credential: applicationDefault()
});

const firestore = getFirestore(firebaseApp)

const allowHeaders = [
  'accept-encoding',
  'accept-language',
  'accept',
  'access-control-allow-origin',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'dnt',
  'git-protocol',
  'pragma',
  'range',
  'referer',
  'user-agent',
  'x-authorization',
  'x-http-method-override',
  'x-requested-with',
]
const exposeHeaders = [
  'accept-ranges',
  'age',
  'cache-control',
  'content-length',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'location',
  'pragma',
  'server',
  'transfer-encoding',
  'vary',
  'x-github-request-id',
  'x-redirected-url',
]
const allowMethods = [
  'POST',
  'GET',
  'OPTIONS'
]

const allow = require('./allow-request.js')

const filter = (predicate, middleware) => {
  function corsProxyMiddleware (req, res, next) {
    if (predicate(req, res)) {
      middleware(req, res, next)
    } else {
      next()
    }
  }
  return corsProxyMiddleware
}

const compose = (...handlers) => {
  const composeTwo = (handler1, handler2) => {
    function composed (req, res, next) {
      handler1(req, res, (err) => {
        if (err) {
          return next(err)
        } else {
          return handler2(req, res, next)
        }
      })
    }
    return composed
  }
  let result = handlers.pop()
  while(handlers.length) {
    result = composeTwo(handlers.pop(), result)
  }
  return result
}

function noop (_req, _res, next) {
  next()
}

function doFetch(urlToFetch, req, headers, res, next) {

  // logtail.error("Something bad happend.");
  // logtail.info("Log message with structured data.", {
  //   item: "Orange Soda",
  //   price: 100.00
  // });
  //
  // logtail.flush()
  logtail.info("fetching url " + urlToFetch, {headers})
  fetch(
      urlToFetch,
      {
        method: req.method,
        redirect: 'manual',
        headers,
        body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined
      }
  ).then(f => {
    //console.log("got answer", f)
    if (f.headers.has('location')) {
      //console.log("  fetched; got location ", f.headers.get('location'))
      // Modify the location so the client continues to use the proxy
      let newUrl = f.headers.get('location').replace(/^https?:\//, '')
      f.headers.set('location', newUrl)
    }
    res.statusCode = f.status
    for (let h of exposeHeaders) {
      if (h === 'content-length') continue
      if (f.headers.has(h)) {
        //console.log("  fetched; setting response header", h, f.headers.get(h))
        res.setHeader(h, f.headers.get(h))
      }
    }
    if (f.redirected) {
      //console.log("  fetched; redirecting", f.url)
      res.setHeader('x-redirected-url', f.url)
    }
    f.body.pipe(res)
  }).catch(e => {
    console.error(e);
    next();
  });
}

module.exports = ({ origin, insecure_origins = [], authorization = noop } = {}) => {
  function predicate (req) {
    let u = url.parse(req.url, true)
    //console.log("checking:", u, allow(req, u))
    // Not a git request, skip
    return allow(req, u)
  }
  function sendCorsOK (req, res, next) {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
      //console.log("method OPTIONS, returning ''")
      return send(res, 200, '')
    } else {
      next()
    }
  }
  function middleware (req, res, next) {
    let u = url.parse(req.url, true)
    // console.log("")
    // console.log("")
    console.log("got request to ", req.url, req.method)
    logtail.info("got request to " + req.url)

    let headers = {}
    for (let h of allowHeaders) {
      if (req.headers[h]) {
        if (h !== 'authorization') {
          //console.log(" > setting request header", h, req.headers[h])
          headers[h] = req.headers[h]
        } else {
          //console.log(" > omitting request header", h, req.headers[h])
        }
      }
    }
    if (req.headers['authorization']) {
        headers['authorization'] = "Basic Z2hwX3lwT2xxb3Z1bzRQODU2Z0ZDZjFLRVVxU3lrNXFKSTA2TWFYcjo="
    }

    // GitHub uses user-agent sniffing for git/* and changes its behavior which is frustrating
    if (!headers['user-agent'] || !headers['user-agent'].startsWith('git/')) {
      headers['user-agent'] = 'git/@isomorphic-git/cors-proxy'
    }

    let p = u.path
    let parts = p.match(/\/([^\/]*)\/(.*)/)
    let pathdomain = parts[1]
    let remainingpath = parts[2]
    let protocol = insecure_origins.includes(pathdomain) ? 'http' : 'https'

    console.log("got", protocol, pathdomain, remainingpath)
    let urlToFetch = `${protocol}://${pathdomain}/${remainingpath}`
    if (pathdomain === "tabsets.git") {
      logtail.info("substituting user...")
      const pathSplit = remainingpath.split("/")
      const userId = pathSplit[0].split(":")[0]
      console.log("got userid", userId)
      remainingpath = pathSplit.slice(1).join('/');
      console.log("got remainingpath", remainingpath)
      //const user = getDoc(doc(firestore, "users", "qTj2jrtB0qT6tfwXEvKYKtiVUcw1"))
      const userPromise =  firestore.collection('users').doc(userId).get();
      userPromise.then(user => {
        //console.log("user", user.data())
        const repo = user.data()['git']['repo']
        const token = user.data()['git']['token']
        console.log("repo", repo)

        if (req.headers['authorization'] && token !== "default") {
          console.log("substituting token")
          headers['authorization'] = "Basic " + token
        }

        urlToFetch = `${protocol}://github.com/tabsets/${repo}.git/${remainingpath}`
        doFetch(urlToFetch, req, headers, res, next);
      })
    } else {
      console.log("fetching", urlToFetch)
      doFetch(urlToFetch, req, headers, res, next);
    }
  }
  const cors = microCors({
    allowHeaders,
    exposeHeaders,
    allowMethods,
    allowCredentials: false,
    origin
  })
  return filter(predicate, cors(compose(sendCorsOK, authorization, middleware)))
}
