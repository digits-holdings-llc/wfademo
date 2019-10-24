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
      'Host': systemConfig.host  
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
async function startDialog() {
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  const db = client.db(DB_NAME)
  if (!client) {
    return;
  }
  try {
    let configColl = db.collection('config')
    let systemConfig = await configColl.findOne()

    let staffColl = db.collection('staff')
    let staffMember = await staffColl.findOne({status: "uncontacted"})
    if (!staffMember) {
      console.log("Ran out of people")
      return
    }
    console.log("Starting dialog with ", staffMember.cell)    
    notify(staffMember.cell, systemConfig.announcement)
    await staffColl.update({cell: staffMember.cell}, {$set: {status: "Contacting"}})
    contactTimeout = setTimeout(async () => {
      notify(staffMember.cell, systemConfig.thankYouAnnouncement)
      // Clear this request
      await staffColl.update({cell: staffMember.cell}, {$set: {status: "declined"}})
      startDialog()
    }, 120000);
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

  console.log("Here's a observer post!", inboundMsg)
  // If this is a session end event, ignore
  if (inboundMsg.type == 'session_end' || inboundMsg.type == 'new_session') {
    console.log("Ignoring session lifecyle hook")
    response.send({})
    return;
  }

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
      response.render('index', { title: 'Workforce Automation Demo', staff: result })
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


app.get('/start', async function(request, response) {
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
  const db = client.db(DB_NAME)
  if (!client) {
    return;
  }
  try {
    let staffColl = db.collection('staff')
    let staffMember = await staffColl.updateMany({}, {$set: {status: "uncontacted"}})
    startDialog()
    response.redirect("/")
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
