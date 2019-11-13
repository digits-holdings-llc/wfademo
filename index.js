const express = require('express')
const app = express()
const port = process.env.WEB_PORT || 80
var MongoClient = require('mongodb').MongoClient
const { GraphQLClient } = require('graphql-request')
var contactTimeout
const mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017/wfa'
const parts = mongoURL.split("/")
const DB_NAME = parts[parts.length - 1]

console.log("DB_NAME", DB_NAME)

async function notify(dst, txt) {
  const client = await MongoClient.connect(mongoURL, { useNewUrlParser: true }).catch(err => {console.log("Mongo Client Connect error", err)})
  if (!client) {
    return;
  }
  try {
    console.log("Notifying ", dst, txt)
    const db = client.db(DB_NAME)
    let collection = db.collection('config')
    let systemConfig = await collection.findOne()
    console.log("Config is ", systemConfig)
    
    const graphQLClient = new GraphQLClient(systemConfig.url, {
      headers: {
        "x-api-token": systemConfig.authorization,
        'Content-Type': 'application/json',
        'Host': systemConfig.host,  
        },
    })
     
    const query = 
      `
      mutation {
        addMessage(
          messageInput: {
            text: "${txt}",
            handle: "${systemConfig.networkHandle}",
            destination: "${dst}"
          }
        )
        {
          _id
        }
      }
      `
    graphQLClient.request(query)
      .then(data => console.log("GraphQL returns ", data))
      .catch(error => console.log("GraphQL error: ",JSON.stringify(error, undefined, 2)))

  } catch (err) {
    console.log("Error caught in notify function")
    console.log(err);
  } finally {
    client.close();
    console.log("Notify ends")
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
    console.log("Start dialog starts")
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
      const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})
      const db = client.db(DB_NAME)    
      let staffColl = db.collection('staff')
      notify(staffMember.cell, systemConfig.noThankYouAnnouncement)
      // Clear this request
      await staffColl.update({cell: staffMember.cell}, {$set: {status: "Declined"}})
      client.close();
      startDialog()
    }, systemConfig.timeout);
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
    console.log("Start dialog ends")
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

  // If this is a session end event, ignore
  if (inboundMsg.type == 'session_end' || inboundMsg.type == 'new_session') {
    console.log("Ignoring session lifecyle hook")
    response.send({})
    return;
  }

  if (!inboundMsg.msg) {
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
    let configColl = db.collection('config')
    let systemConfig = await configColl.findOne()

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
        collection.update({cell: staffMember.cell}, {$set: {status: "Accepted"}})
        notify(staffMember.cell, systemConfig.thankYouAnnouncement)
      }
      if (inboundMsg.msg.txt.toUpperCase().trim() == "NO") {
        console.log("Not him")
        // Cancel the timer
        if (typeof contactTimeout !== 'undefined') {
          clearTimeout(contactTimeout)
        }
        collection.update({cell: staffMember.cell}, {$set: {status: "Declined"}})
        notify(staffMember.cell, systemConfig.nextTimeAnnouncement)
      }
    }    
    response.send({})
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
})

// Access the parse results as request.body
app.post('/config', async function(request, response){
  var inboundMsg = request.body;
  console.log("Posted the following ", request.body)
  const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})

  try {
    const db = client.db(DB_NAME)
    let configColl = db.collection('config')
    await configColl.updateMany({}, { $set: request.body} )
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
  }
  response.redirect("/config")
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

app.get('/config', function(request, response) {
  MongoClient.connect(mongoURL, function (err, client) {
    if (err) throw err
    var db = client.db(DB_NAME)
    db.collection('config').findOne({}, function (err, result) {
      if (err) throw err
      console.log("Found configuration ", result)
      response.render('config', { title: 'Workforce Automation Demo', config: result })
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
    console.log("Start begins")
    let staffColl = db.collection('staff')
    await staffColl.updateMany({}, {$set: {status: "uncontacted"}})
    startDialog()
    response.redirect("/")
  } catch (err) {
    console.log(err);
  } finally {
    client.close();
    console.log("Start ends")
  }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
