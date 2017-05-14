var url = require('url');
var mqtt_url = url.parse(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883');
const mqtt = require('mqtt');
/*
MQTT provides Last Will and Testament (LWT) to detect lost connections and handle it by publishing connected = false. I was thinking it should be good enough.
*/

const kitchen_alarm_topic = 'kitchen/alarm/smoke/connected';
const kitchen_alarm_state_topic = 'kitchen/alarm/smoke/state';

const client = mqtt.connect(mqtt_url,{
  keepalive: 10, // after 10 second time-out the broker will publish a message if the monitor dies
  clean: true, // set to false to receive QoS 1 and 2 messages while offline
  will: {
    topic: kitchen_alarm_topic,
    payload: 'false',
    qos: 2, //Exactly once
    retain: true
  }});

/**
 * Want to notify controller that alarm is disconnected before shutting down
 */
function handleAppExit (options, err) {  
  if (err) {
    console.log(err.stack)
  }

  if (options.cleanup) {
	client.publish(kitchen_alarm_topic, 'false', {qos: 2, retain: true});
  }

  if (options.exit) {
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

try {
    console.log(require.resolve("mraa"));
	
	// libmraa - Low Level Skeleton Library for Communication
	var mraa = require('mraa');
	console.log('MRAA Version: ' + mraa.getVersion());
	// Analog audio sensor attached to pin 0
	var audio = new mraa.Aio(0);
	// Set the audio threshold
	var threshold = 470;
	// Wait before trigger alarm to reduce false positives
	var audioCounter = 0;
	var state = false;

	// Run the function to start out
	processAudio();

	client.publish(kitchen_alarm_topic, 'true', {qos: 2, retain: true}, function() {
		console.log("Kitchen alarms detector connected");
		client.publish(kitchen_alarm_state_topic, 'false', {qos: 2, retain: true});
	});
	
} catch(e) {
    console.error("mraa is not found");
		client.publish(kitchen_alarm_topic, 'false', {qos: 2, retain: true}, function() {
		console.log("Kitchen alarms detector not connected");
	});
    //process.exit(e.code);
}


// Declare the sound check function
function processAudio(){
  // read the value to start off
  var level = audio.read();

  // If the sound is higher than the threshold, make the request
  if(level >= threshold){
    audioCounter=audioCounter+10;
	console.log('Above treashold ' + level + ' counter ' + audioCounter);
	if(audioCounter>50){
		state = true;
		setTimeout(processAudio, 60*1000); //wait 60 seconds before activating it again
		client.publish(kitchen_alarm_state_topic, 'true', {qos: 2, retain: true}, function() {
			console.log('Audio alarm detected ' + level + ' counter ' + audioCounter);
		});
		audioCounter=0; //reset counter
	}
	else {
		setTimeout(processAudio, 100);
	}
  } else {
    if(audioCounter>0){
		audioCounter--;
	}else if(state){
		state = false; //switch off alarm
		client.publish(kitchen_alarm_state_topic, 'false', {qos: 2, retain: true}, function() {
			console.log('Audio alarm switched off ' + level + ' counter ' + audioCounter);
		});
	}
    setTimeout(processAudio, 100);
    //console.log(level + ' counter ' + audioCounter);
  }
}