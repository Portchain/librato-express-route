
const _ = require('lodash')

function hrtimeToMs(hrtime) {
  return hrtime[0]*1000 + hrtime[1]/1000;
}
function diffHrtime(a, b) {
  return (a[0] - b[0]) * 1000 + (a[1] - b[1]) / 1000000
}

const os = require('os')

const GLOBAL_TAGS = {
  host: os.hostname()
}

function Middleware(options) {
  options = options || {}

  let libratoEmail = options.libratoEmail || process.env.LIBRATO_EMAIL
  let libratoToken = options.libratoToken || process.env.LIBRATO_TOKEN

  if(!libratoEmail || !libratoToken) {
    console.log('Disabling performance monitoring because librato email and/or token are not set')
    return (req, res, next) => {next()}
  }
  
  var client = require('librato-metrics').createClient({
    email: libratoEmail,
    token: libratoToken
  });
  
  var queuedMeasurements = []

  function processMeasurement(req, measurement) {
    setTimeout(() => {
      let pathElements = req.url.split('/')
      let responseTime = diffHrtime(measurement.end, measurement.start)
      let path = ''
      let tags = _.defaults(req.params, GLOBAL_TAGS)
      queuedMeasurements.push({
        name: 'http.response_time_ms',
        value: responseTime,
        tags: tags
      })
      pathElements.forEach(pathElement => {
        if(pathElement) {
          path += '.' + pathElement
          queuedMeasurements.push({
            name: `http${path}.response_time_ms`,
            value: responseTime,
            tags: tags
          })
        }
      })
    })
  }

  setInterval(() => {
    if(queuedMeasurements.length > 0) {
      let measurementsToFlush = queuedMeasurements
      queuedMeasurements = []
      console.log(JSON.stringify(measurementsToFlush, null, 2))
      //return;
      client.post('/measurements', {
        measurements: measurementsToFlush,
      }, function(response) {
        if(response && response.statusCode >= 200 && response.statusCode < 300) {
          
        } else {
          //console.log(response);
        }
      });
    }
  }, options.flushInterval || 5000)
  
  function interceptResponse(req, res, measurement) {
    var oldSend = res.send
    res.send = function() {
      if(!measurement.end) {
        measurement.end = process.hrtime()
        processMeasurement(req, measurement)
      }
      oldSend.apply(res, arguments)
    }
    var oldEnd = res.end
    res.end = function() {
      if(!measurement.end) {
        measurement.end = process.hrtime()
        processMeasurement(req, measurement)
      }
      oldEnd.apply(res, arguments)
    }
  }
  
  return function(req, res, next) {
    if(!/\.[a-z]+$/.test(req.url)) {
      var measurement = {
        start: process.hrtime()
      }
      interceptResponse(req, res, measurement)
    }
    next()
  }
  
}

module.exports = Middleware
