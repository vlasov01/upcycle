// connected home alarm monitor

// Slack connector
var WebClient = require('@slack/client').WebClient;

// SLACK_API_TOKEN starts with xoxp
var token = process.env.SLACK_API_TOKEN;
  
// Heartbeats API setup
var heartbeats = require('heartbeats');

// a heart that beats every 5 minutes (monitor the monitor).
var heart = heartbeats.createHeart(5*60*1000);
var request = require('request');

heart.createEvent(1, function(count, last){
var ping = 'https://cronitor.link/'+process.env.CRONITOR_MONITOR+'/complete?auth_key='+process.env.CRONITOR_AUTH_TOKEN;

request(ping, function (error, response, body) {
   if (!error && response.statusCode == 200) {
	 console.log(body);
   }
   else {
     console.log('Cronitor request:', ping); // Print the request URL
     console.log('Cronitor error:', error); // Print the error
     console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received 
     console.log('body:', body); // Print the HTML
   }
 });
});

var url = require('url');
var mqtt_url = url.parse(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883');
const mqtt = require('mqtt');
/*
MQTT provides Last Will and Testament (LWT) to detect lost connections and handle it by publishing connected = false. I was thinking it should be good enough.
*/

const monitor_topic = 'home/alarm/monitor/connected';

const client = mqtt.connect(mqtt_url,{
  keepalive: 10, // after 10 second time-out the broker will publish a message if the monitor dies
  clean: true, // set to false to receive QoS 1 and 2 messages while offline
  will: {
    topic: monitor_topic,
    payload: 'false',
    qos: 2, //Exactly once
    retain: true
  }});

/* Topics structure based on best practices http://www.hivemq.com/blog/mqtt-essentials-part-5-mqtt-topics-best-practices

 An alarm sensor topic structure
 <location>/<alarm>/<sensor type>/<connected>|<state>
 Examples:
 kitchen/alarm/smoke/connected
 kitchen/alarm/smoke/state
 
 A monitor topic structure
 <location>/<alarm>/<monitor type>/<connected>
 Example:
 home/alarm/monitor/connected
 
 An appliance topic structure
 <location>/<appliance>/<appliance type>/<connected>|<command>
 Example:
 kitchen/appliance/oven/power
 
 A message can be published to a topic as true or false
 Examples:
 1. A smoke alarm is connected in a kitchen.
 kitchen/alarm/smoke/connected/true
 2. A smoke alarm in a kitchen detected smoke.
 kitchen/alarm/smoke/state/true
 3. A command to turn power off for an oven in a kitchen
 kitchen/appliance/oven/power/off
*/

client.on('connect', () => {
  //monitor is connected now
  client.publish(monitor_topic, 'true', {qos: 2, retain: true}, function() {
    console.log("Home alarms monitor connected");
  });

  //subscription to smoke detector alarms and connection states from any location
  client.subscribe('+/alarm/smoke/+', {qos: 2})
  //subscription to alarms monitors connection states from any location
  //this subscription is useful for logging/testing
  client.subscribe('+/alarm/monitor/+', {qos: 2})
  
  // publish a message to a topic - "The home alarm monitor is connected"
  //Mosquitto conf /etc/mosquitto/mosquitto.conf should be configured to support retained messages
  //persistence true
  //persistence_location /var/lib/mosquitto/
})

client.on('message', (topic, message) => {  
  var arr = topic.split("/");

  //Location as example can be "home", "workshop" or "kitchen"
  var location = arr[0];

  //alarm, appliance or monitor
  var context = arr[1];

  //smoke, oven, outlet-1  
  var context_type = arr[2];
  
  //state, power or connected
  var topicType = arr[3];
  
  switch (topicType) {
    case 'connected':
      return handleAlarmConnected(location, context, context_type, topicType, message)
    case 'state':
      return handleAlarmState(location, context, context_type, topicType, message)
    case 'power':
      return handleCommand(location, message)
  }
  console.log('No handler for topic %s location %s', topic, location)
})

client.on('close', function(){
    console.log("MQTT Client connection closed; Broker:"+mqtt_url.host)
    //client.end()
})

client.on('error', function(){
    console.log("MQTT Client ERROR; Broker:"+mqtt_url.host)
    //client.end()
})

client.on('disconnect', function(){
    console.log("MQTT Client disconnected; Broker:"+mqtt_url.host)
    //client.end()
})

client.on('reconnect', function(){
    console.log("MQTT Client reconnect attempt; Broker:"+mqtt_url.host)
    //client.end()
})

//offline

function handleAlarmConnected (location, context, context_type, topicType, message) {  
  //Generated message will have the following format "home alarm monitor is connected"
  txt_message = '{3} {0} {1} is {2}'.format(context, context_type, (message.toString() === 'true')?'connected':'disconnected', location)
  console.log(txt_message)
  sendMessage(location, txt_message)
}

function handleAlarmState (location, context, context_type, topicType, message) {
  txt_message = '{3} {0} {1} is {2}'.format(context, context_type, (message.toString() === 'true')?'ON':'OFF', location)
  //console.log('alarm state update to %s location %s', message, location)
  console.log(txt_message)
  sendMessage(location, txt_message)
  alarmOn = (message.toString() === 'true')  
  if (alarmOn) {
    var command_topic = location+"/appliance/all/power";
	//example: each appliance located in a kitchen should subscribe to kitchen/appliance/all/power
	//or define rules for specific actions
	//retain: false no need to reset it after event
    client.publish(command_topic, 'off', {qos: 2, retain: false}, function() {
	  const OFF_MESSAGE = 'command published to switch power off to all managed appliances at location '+location;
	  sendMessage(location, OFF_MESSAGE);
      console.log(OFF_MESSAGE+", for topic: "+command_topic );
    });
  }
}

function handleCommand (location, message) {  
  console.log('command %s location %s', message, location)
  //connected = (message.toString() === 'true')
  //sendStateUpdate(location, message)
}

// Send message to Slack channel
function sendMessage(location, message) {  
  console.log('sending message %s for location %s', message, location)
  var web = new WebClient(token);
  web.chat.postMessage(
	process.env.SLACK_CHANNEL, message, { username: location },
	function(err, res) {
	if (err) {
		console.log('Slack Error: ', err);
		console.log('Slack Token: ', token);
		console.log('Slack Channel:',process.env.SLACK_CHANNEL);
		console.log('Message      : ', message);
		console.log('Username     : ', location);
	} else {
		console.log('Message sent: ', res);
	}
  });
}

/**
 * Want to notify controller that alarm is disconnected before shutting down
 */
function handleAppExit (options, err) {  
  if (err) {
    console.log(err.stack)
  }

  if (options.cleanup) {
    client.publish(monitor_topic, 'false', {qos: 2, retain: true});
  }

  if (options.exit) {
	heart.kill();
    process.exit()
  }
}

/**
 * Handle the different ways an application can shutdown
 */
process.on('exit', handleAppExit.bind(null, {  
  cleanup: true
}))
process.on('SIGINT', handleAppExit.bind(null, {  
  exit: true
}))
process.on('uncaughtException', handleAppExit.bind(null, {  
  exit: true
}))

String.prototype.format = function() {
    var formatted = this;
    for( var arg in arguments ) {
        formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    }
    return formatted;
};
