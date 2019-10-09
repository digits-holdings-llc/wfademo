const express = require('express')
const app = express()
const port = 80
var MongoClient = require('mongodb').MongoClient
const axios = require('axios')
var contactTimeout
const mongoURL='mongodb://localhost:27017/demo'

function notify(dst, txt) {
  var url = "https://app.tendigittext.com/sendMsg"
  
  var params = {
    txt,
    dst
  }
  var headers = {
    "authorization": "uMCvYfW4Z7dxrpyiq"
  }
  config = {
    headers, 
    params
  }
  axios.get(url, config)
  .catch((error) => {
    console.error(error)
  })
}

function add(cell) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db('test')
    db.collection('staff').insert({cell}, function (err, result) {
      if (err) throw err
    })
  })
}
function deleteStaff(cell) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db('test')
    db.collection('staff').remove({cell}, function (err, result) {
      if (err) throw err
    })
  })
}

// Parse JSON bodies (as sent by API clients)
app.use(express.json());
app.use(express.urlencoded());
app.set('view engine', 'pug')
app.set('views', './views')

// Access the parse results as request.body
app.post('/', function(request, response){
    var inboundMsg = request.body;
    console.log("New message : ", inboundMsg.msg.src, ":", inboundMsg.msg.txt)
    if (request.body.msg.direction == "egress") {
      console.log("Ignoring egress message")
      response.send({})
    } else {
      MongoClient.connect(mongoURL, function (err, client) {
        if (err) throw err
        var db = client.db('test')
        db.collection('staff').findOne({status: "Contacting"}, function (err, r) {
          if (err) throw err
          console.log("We are currently speaking with ", r)  
          if ("1"+inboundMsg.msg.src == r.cell) {
            console.log("And this is him!")
            if (inboundMsg.msg.txt.toUpperCase().trim() == "YES") {
              console.log("Winner winner chicken dinner")
              // Cancel the timer
              if (typeof contactTimeout !== 'undefined') {
                clearTimeout(contactTimeout)
              }
              db.collection("staff").update({cell: r.cell}, {$set: {status: "Accepted"}})
              notify(r.cell, "Thank you. We will be in touch with details soon.")
            }
          }    
          response.send({})
        })
      })  
    }
  });

app.get('/', function(request, response) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db('test')
    db.collection('staff').find().toArray(function (err, result) {
      if (err) throw err
      response.render('index', { title: 'Hey', staff: result })
    })
  })
})

app.get('/delete/:id', function(request, response) {
  console.log("Deleting", request.params.id) 
  deleteStaff(request.params.id)
  response.redirect("/")
})

app.post('/new_staff', function(request, response) {
  add(request.body.cell)
  response.redirect("/")
  })

function startDialog() {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db('test')
 
    db.collection('staff').findOne({status: "uncontacted"}, function (err, staff) {
      if (err) throw err
      if (!staff) {
        console.log("Ran out of people")
        return
      }
      console.log("Starting dialog with ", staff.cell)    
      var announcement = "Looking for crew for FLIGHT 001, BOS-PVD, TUE 8:40AM. Please send a YES back if you can help out"
      notify(staff.cell, announcement)
      db.collection("staff").update({cell: staff.cell}, {$set: {status: "Contacting"}})
      // Set a timeout 
      contactTimeout = setTimeout(() => {
        notify(staff.cell, "OK, we will look for other staff. Thank you!")
        // Clear this request
        db.collection("staff").update({cell: staff.cell}, {$set: {status: "declined"}}, function (err, result) {
          // Find the next one
          startDialog()
        })
      }, 120000);
    })
  })
}

app.get('/start', function(request, response) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db('test')
    db.collection("staff").updateMany({}, {$set: {status: "uncontacted"}}, function (err, r) {
      if (err) throw err
      startDialog()
      console.log("Started")
      response.redirect("/")
    })
  })
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
