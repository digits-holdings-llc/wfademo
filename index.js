const express = require('express')
const app = express()
const port = process.env.WEB_PORT || 80
var MongoClient = require('mongodb').MongoClient
const axios = require('axios')
var contactTimeout
const mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017/wfa'
const parts = mongoURL.split("/")
const DB_NAME = parts[parts.length - 1]

console.log("DB_NAME", DB_NAME)

async function notify(dst, txt) {
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  if (!client) {
    return;
  }
  try {
    console.log("Notifying ", dst, txt)
    const db = client.db(DB_NAME)
    let collection = db.collection('config')
    let systemConfig = await collection.findOne()
    console.log("Config is ", systemConfig)
    var params = {
      txt,
      dst
    }
    var headers = {
      "Authorization": systemConfig.authorization,
      'Content-Type': 'application/json',
      'Host': 'qa.digits.holdings'
    }
    httpConfig = {
      headers, 
      params
    }
    axios.get(systemConfig.url, httpConfig)
    .catch((error) => {
      console.error(error)
    })
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
}

async function add(cell) {
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  if (!client) {
    return;
  }
  try {
    console.log("Adding ", cell)
    const db = client.db(DB_NAME)
    let collection = db.collection('staff')
    await collection.insertOne({cell})
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
}

async function deleteStaff(cell) {
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  if (!client) {
    return;
  }
  try {
    console.log("Removing ", cell)
    const db = client.db(DB_NAME)
    let collection = db.collection('staff')
    await collection.deleteMany({cell})
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
}

// Parse JSON bodies (as sent by API clients)
app.use(express.json());
app.use(express.urlencoded());
app.set('view engine', 'pug')
app.set('views', './views')

// Access the parse results as request.body
app.post('/', async function(request, response){
  var inboundMsg = request.body;
  console.log("Here's a new message!", inboundMsg)
  console.log("New message : ", inboundMsg.msg.src, ":", inboundMsg.msg.txt)
  if (request.body.msg.direction == "egress") {
    console.log("Ignoring egress message")
    response.send({})
    return;
  } 
    
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  if (!client) {
    console.log("Cannot attach")
    return;
  }
  try {
    const db = client.db(DB_NAME)
    let collection = db.collection('staff')
    let staffMember = await collection.findOne({status: "Contacting"})
    if (!staffMember) {
      console.log("No staff member here")
      response.send({})
      return
    }
    console.log("We are currently speaking with ", staffMember)  
    if (inboundMsg.msg.src == staffMember.cell) {
      console.log("And this is him!")
      if (inboundMsg.msg.txt.toUpperCase().trim() == "YES") {
        console.log("Winner winner chicken dinner")
        // Cancel the timer
        if (typeof contactTimeout !== 'undefined') {
          clearTimeout(contactTimeout)
        }
        db.collection("staff").update({cell: staffMember.cell}, {$set: {status: "Accepted"}})
        notify(staffMember.cell, "Thank you. We will be in touch with details soon.")
      }
    }    
    response.send({})
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
})

app.get('/', function(request, response) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db(DB_NAME)
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
    var db = client.db(DB_NAME)
 
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
    var db = client.db(DB_NAME)
    db.collection("staff").updateMany({}, {$set: {status: "uncontacted"}}, function (err, r) {
      if (err) throw err
      startDialog()
      console.log("Started")
      response.redirect("/")
    })
  })
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
