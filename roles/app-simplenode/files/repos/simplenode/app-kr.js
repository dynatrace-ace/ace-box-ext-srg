const EMPTY = "<EMPTY>";
var port = process.env.PORT || 8080,
	http = require('http'),
	fs = require('fs'),
	os = require('os'),
	sem = require('semver'),
	dttags = process.env.DT_TAGS || EMPTY,
	dtcustprops = process.env.DT_CUSTOM_PROP || EMPTY,
	dtclusterid = process.env.DT_CLUSTER_ID || EMPTY,
	namespace = process.env.NAMESPACE || EMPTY,
	pod_name = process.env.POD_NAME || EMPTY,
	deployment_name = process.env.DEPLOYMENT_NAME || EMPTY,
	container_image = process.env.CONTAINER_IMAGE || EMPTY,
	cloud_automation_project = process.env.CLOUD_AUTOMATION_PROJECT || EMPTY,
	cloud_automation_stage = process.env.CLOUD_AUTOMATION_STAGE || EMPTY,
	cloud_automation_service = process.env.CLOUD_AUTOMATION_SERVICE || EMPTY,
  html = fs.readFileSync('index.html').toString().replace("HOSTNAME", os.hostname()); //  + " with DT_TAGS=" + dttags + "\nDT_CUSTOM_PROP=" + dtcustprops + "\nDT_CLUSTER_ID=" + dtclusterid);
	sver = sem.valid('1.2.3') // semver is loaded for a medium level appsec vulneraility

// ======================================================================
// Here are some global config entries that change the behavior of the app
// ======================================================================
var buildNumber = 1;
var minSleep = 200;
var requestCount = 0;
var inProduction = false;
var invokeRequestCount = 0;
var failInvokeRequestPercentage = 0;


// collect request info
var requests = [];
var requestTrimThreshold = 5000;
var requestTrimSize = 4000;


// ======================================================================
// does some init checks and sets variables!
// ======================================================================
var init = function(newBuildNumber) {
	// MAKE SURE we have a good NAMESPACE
	if(!namespace || (namespace.length == 0) || (namespace == EMPTY)) {
		if(cloud_automation_stage && cloud_automation_stage.length)
			namespace = cloud_automation_stage;	
		else if(deployment_name && deployment_name.length)
			namespace = deployment_name;	
		else if(cloud_automation_stage && pod_name.length)
			namespace = pod_name;	
	}

	// CHECK IF WE ARE RUNNING "In Production"
	// first we check if somebody set the deployment_group_name env-variable
	inProduction = process.env.DT_RELEASE_STAGE && 
		(process.env.DT_RELEASE_STAGE.includes("production") || process.env.DT_RELEASE_STAGE.includes("canary"));
	
	// second we check whether our host or podname includes blue or green in its name - we use this for blue/green deployments in production
	if(!inProduction) {
		inProduction = os.hostname().includes("green") || os.hostname().includes("blue");
		if(!inProduction) {
			inProduction = namespace && namespace.toLowerCase().includes("prod");
		}
	}
	
	if(inProduction) {
		minSleep = 100; // we just simulate that production is a bit faster than staging, e.g: better hardware!
	}

	// here are some "problems" we simulate for different builds. Builds are identified via Env Variable BUILD_NUMBER;
	// Build # | Problem
	// 1 | no problem
	// 2 | 50% of requests return HTTP 500 Status Code
	// 3 | back to normal
	// 4 | no problem in staging but problem in prod -> higher sleep time and 10% of requests fail
	// X | any other build number will run like 1 & 3
	if(newBuildNumber != null) {
		buildNumber = parseInt(newBuildNumber);
	}
	else if(process.env.BUILD_NUMBER && process.env.BUILD_NUMBER != null) {
		buildNumber = parseInt(process.env.BUILD_NUMBER);
    }

	switch(buildNumber) {
		case 2:
			minSleep = 600;
			break;
		case 4: 
			minSleep = minSleep * 2;
			failInvokeRequestPercentage = 50;
			break;
		case 5:
			// introduce HIGH appsec vulnerability
			var merge = require("@brikcss/merge")
			var obj = {}
			var malicious_payload = '{"__proto__":{"polluted":"Yes! Its Polluted"}}';
			console.log("Before: " + {}.polluted);
			merge({}, JSON.parse(malicious_payload));
			console.log("After : " + {}.polluted);
			break;
		default:
			// everything normal here
			failInvokeRequestPercentage = 0;		
			break;
	}

	console.log("Init: " + buildNumber + "/" + failInvokeRequestPercentage + "/" + minSleep);
} 

// ======================================================================
// Background colors for our app depending on the build
// ======================================================================
var backgroundColors = ["#D6D4D2", "#73A53E", "#FF7C00", "#D3D309", "#4AB9D9"]
var getBackgroundColor = function() {
	var buildNumberForBackgroundColor = buildNumber;
	if(buildNumber == 0 || buildNumber > 4) buildNumberForBackgroundColor = 1;
	
	return backgroundColors[buildNumberForBackgroundColor];
}


// ======================================================================
// This is for logging
// ======================================================================
//var logstream = fs.createWriteStream('./serviceoutput.log');
var SEVERITY_DEBUG = "Debug";
var SEVERITY_INFO = "Info";
var SEVERITY_WARNING = "Warning";
var SEVERITY_ERROR = "Error";

var log = function(severity, entry) {
	if (severity === SEVERITY_DEBUG) {
		// dont log debug
	} else {
		var logEntry = new Date().toISOString() + ' - ' + severity + " - " + entry + '\n';
		//logstream.write(logEntry);
		//console.log is better suited for containers
		console.log(logEntry);
	}
};

// ======================================================================
// Very inefficient way to "sleep"
// ======================================================================
function sleep(time) {
	if(time < minSleep) time = minSleep;
	var stop = new Date().getTime();
    while(new Date().getTime() < stop + time) {
		;
    }
}

function getRequestsPerMinute() {
	var now = Date.now();
	var aMinuteAgo = now - (1000 * 60);
	var cnt = 0;
	// since recent requests are at the end of the array, search the array
	// from back to front
	for (var i = requests.length - 1; i >= 0; i--) {
		if (requests[i] >= aMinuteAgo) {
			++cnt;
		} else {
			break;
		}
	}
	return cnt
}

// ======================================================================
// This is our main HttpServer Handler
// ======================================================================
var server = http.createServer(async function (req, res) {

	requests.push(Date.now());

	// now keep requests array from growing forever
	if (requests.length > requestTrimThreshold) {
		requests = requests.slice(0, requests.length - requestTrimSize);
	}
	log(SEVERITY_INFO, req.method + ' - ' + req.url);

    if (req.method === 'POST') {
        var body = '';

        req.on('data', function(chunk) {
            body += chunk;
        });

        req.on('end', function() {
            if (req.url === '/') {
                log(SEVERITY_DEBUG, 'Received message: ' + body);
            } else if (req.url = '/scheduled') {
                log(SEVERITY_DEBUG, 'Received task ' + req.headers['x-aws-sqsd-taskname'] + ' scheduled at ' + req.headers['x-aws-sqsd-scheduled-at']);
            }

            res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});
            res.end();
        });
    } else if (req.url.startsWith("/api")) {
		var url = require('url').parse(req.url, true);
		var closeResponse = true;

        // sleep a bit :-)
		var sleeptime = parseInt(url.query["sleep"]);
		if(sleeptime === 0 || isNaN(sleeptime) ) sleeptime = minSleep;
		log(SEVERITY_INFO, "Sleeptime: " + sleeptime);
		sleep(sleeptime);

		// figure out which API call they want to execute
        var status = "Unkown API Call";
		if(url.pathname === "/api/sleeptime") {
			// Usage: /api/sleeptime?min=1234 
			var sleepValue = parseInt(url.query["min"]);
			if(sleepValue >= 0 && sleepValue <= 10000) minSleep = sleepValue;
			status = "Minimum Sleep Time set to " + minSleep;
		}
		if(url.pathname === "/api/echo") {
			// Usage: /api/echo?text=your text to be echoed!
			status = "Thanks for saying: " + url.query["text"];
		}
		if(url.pathname === "/api/login") {
			// Usage: /api/login?username=your user name 
			status = "Welcome " + url.query["username"];
		}
		if(url.pathname === "/api/invoke") {
			// count the invokes for failed requests
			var returnStatusCode = 200;
			if(failInvokeRequestPercentage > 0) {
				invokeRequestCount++;
				var failRequest = (invokeRequestCount % (100 / failInvokeRequestPercentage));
				log(SEVERITY_INFO, invokeRequestCount + "%" + failInvokeRequestPercentage + "=" + failRequest);
				//console.log(invokeRequestCount + "%" + failInvokeRequestPercentage + "=" + failRequest);
				if(failRequest == 0) {
					returnStatusCode = 500;
					invokeRequestCount = 0;
				}
			}

			// Usage: /api/invoke?url=http://www.yourdomain.com 
			var urlRequest = url.query["url"];
			status = "Trying to invoke remote call to: " + urlRequest;
			
			var http = null;
			if(urlRequest.startsWith("https")) http = require("https");
			else http = require("http");
			closeResponse = false;
			var options = {
              	host: urlRequest,
              	path: '/'
            };

			// http.get('https://jsonplaceholder.typicode.com/users', res => {
			// 	let data = [];
			// 	const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
			// 	log(SEVERITY_DEBUG, 'STATUS: ' + res.statusCode);
			// 	log(SEVERITY_DEBUG, 'HEADERS: ' + JSON.stringify(res.headers));

			// 	res.on('data', chunk => {
			// 		data.push(chunk);
			// 	});

			// 	res.on('end', () => {
			// 		console.log('Response ended: ');
			// 		const users = JSON.parse(Buffer.concat(data).toString());

			// 		for(user of users) {
			// 		console.log(`Got user with id: ${user.id}, name: ${user.name}`);
			// 		}
			// 	});
			// }).on('error', err => {
			// 	console.log('Error: ', err.message);
			// });

			var result = http.get(urlRequest, function(getResponse) {
				log(SEVERITY_DEBUG, 'STATUS: ' + getResponse.statusCode);
				log(SEVERITY_DEBUG, 'HEADERS: ' + JSON.stringify(getResponse.headers));

				// Buffer the body entirely for processing as a whole.
				var bodyChunks = [];
				getResponse.on('data', function(chunk) {
					bodyChunks.push(chunk);
				}).on('end', function() {
					var body = Buffer.concat(bodyChunks);
				  	log(SEVERITY_WARNING, 'BODY: ' + body);
				  	status = "Request to '" + url.query["url"] + "' returned with HTTP Status: " + getResponse.statusCode + " and response body length: " + body.length;
				  	log(SEVERITY_INFO, status);
					
					if(returnStatusCode == 500) {
						status = "Request to '" + url.query["url"] + "' returned in an error!";
						log(SEVERITY_ERROR, status);
					}

					  res.writeHead(returnStatusCode, returnStatusCode == 200 ? 'OK' : 'ERROR', {'Content-Type': 'text/plain'});	
				  	res.write(status);
				  	res.end();
				}).on('error', function(error) {
				  	status = "Request to '" + url.query["url"] + "' returned in an error: " + error;
					log(SEVERITY_ERROR, status);
				  	res.writeHead(returnStatusCode, returnStatusCode == 200 ? 'OK' : 'ERROR', {'Content-Type': 'text/plain'});	
				  	res.write(status);
				  	res.end();					
				})
			});
		}
		if(url.pathname === "/api/version") {
			if (url.query["newBuildNumber"] && url.query["newBuildNumber"] != null) {
				var newBuildNumber = url.query["newBuildNumber"];
				log(SEVERITY_WARNING, "Somebody is changing! buildNumber from " + buildNumber + " to " + newBuildNumber);

				init(newBuildNumber);
			}

			// usage: /api/version
			// simply returns the build number as defined in BUILD_NUMBER env-variable which is specified
			status = "Running build number: " + buildNumber + " Production-Mode: " + inProduction;
			status += "\n\nHere some additional environment variables:";
			status += "\nCLOUD_AUTOMATION_PROJECT: " + cloud_automation_project;
			status += "\nCLOUD_AUTOMATION_STAGE: " + cloud_automation_stage;
			status += "\nCLOUD_AUTOMATION_SERVICE: " + cloud_automation_service;
			status += "\nDT_TAGS: " + dttags;
			status += "\nDT_CUSTOM_PROP: " + dtcustprops;
			status += "\nDT_CLUSTER_ID: " + dtclusterid;
			status += "\nDEPLOYMENT_NAME: " + deployment_name;
			status += "\nCONTAINER_IMAGE: " + container_image;
			status += "\nPOD_NAME: " + pod_name;
			status += "\nNAMESPACE: " + namespace;
		}
		if(url.pathname === "/api/causeerror") {
			log(SEVERITY_ERROR, "somebody called /api/causeerror");
			status = "We just caused an error log entry"
		}
		if (url.pathname === "/api/cpuload") {
			const reqPerMin = getRequestsPerMinute();
			let sleepTime = 1200;

			if (reqPerMin <= 70) {
				sleepTime = Math.pow(reqPerMin, 2) - Math.pow(reqPerMin, 3) / 100;
			}

			if (reqPerMin <= 45) {
				sleepTime = (Math.pow(reqPerMin, 2) - Math.pow(reqPerMin, 3) / 100) / 2;
			}

			console.log("Sleeping for " + sleepTime + "ms");
			sleep(sleepTime);

			status = "Request finished";
		}
		if(url.pathname === "/healthz") {
			// Usage: /api/login?username=your user name 
			status = "OK";
		}

		// only close response handler if we are done with work!
		if(closeResponse) {
		   res.writeHead(200, 'OK', {'Content-Type': 'text/plain'});	
		   res.write(status);
		   res.end();
		}
	}
	else
	{
		res.writeHead(200, 'OK', {'Content-Type': 'text/html'});

		// replace buildnumber and background color
		var finalHtml = html.replace("BACKGROUND-COLOR", getBackgroundColor()).replace("BUILD_NUMBER", buildNumber).replace("NAMESPACE", namespace);
        res.write(finalHtml);
        res.end();
	}
	
	requestCount++;
	if(requestCount >= 100) {
		log(SEVERITY_INFO, "Just served another 100 requests!");
		requestCount = 0;
	}
});

// first we initialize!
init(null);

// Listen on port 80, IP defaults to 127.0.0.1
server.listen(port);

// Put a friendly message on the terminal
console.log('Server running at http://127.0.0.1:' + port + '/');
log(SEVERITY_INFO, "Service is up and running - feed me with data!");