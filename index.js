
const path = require('path');
const exec = require('child_process').exec;
const crypto = require('crypto');
const fs = require('fs');
const AWS = require('aws-sdk');
const validUrl = require('valid-url');
const fetch = require("node-fetch");

// overall constants
const screenWidth = 600;
const screenHeight = 952.28;

var allsvgs = {};
const getSVGData = (url) => {

	return fetch(url)
	.then((res) => res.text())
	.then((svg) => {
		allsvgs[url] = svg;
	})
	.catch((error) => error);
}

exports.handler = function(event, context, cb) {
	
	process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

	const targetSvgUrls = event.svgs;
	const targetHtmlUrl = event.html;
	const outputName = event.name;
	const timeout = parseInt(event.timeout) || 3000;

	if(!Array.isArray(targetSvgUrls)){
	  cb(`422, please provide an array of svgs`);
      return false;
	}	

	
	// get text from SVGs
	
	var proms = []
	for (var i = 0; i < targetSvgUrls.length; i++) {
		
		// check if the given url is valid
		if (!validUrl.isUri(targetSvgUrls[i])) {
			cb(`422, please provide a valid svg url, not: ${targetSvgUrls[i]}`);
			return false;
		  }
		// create promises to get all svgs
		let prom = getSVGData(targetSvgUrls[i]);
		proms.push(prom);
	}

	// get text from html
	let html = '';
	if (targetHtmlUrl) {
		if (!validUrl.isUri(targetHtmlUrl)) {
			cb(`422, please provide a valid html url, not: ${targetHtmlUrl}`);
			return false;
			}
		let htmlProm = fetch(targetHtmlUrl)
		.then((res) => res.text())
		.then((htmlText) => html = htmlText)
		.catch((error) => error);
	
		proms.push(htmlProm);
	}

	Promise.all(proms).then(() => {
		var svgs = '';
		for (var i = 0; i < targetSvgUrls.length; i++) {
			svgs += '\n' + allsvgs[targetSvgUrls[i]] + '\n';
		}

    svgs = svgs.replace(/\<\?xml.+\?\>/g, '');
		// svgs = svgs.replace(/\r?\n|\r/g, ' ');
		allsvgs = {};

		console.log(svgs);
		

		const targetBucket = process.env['BUCKET'];
		// temp file hash name
		const targetHash = crypto.createHash('md5').update(outputName).digest('hex');
		const targetFilename = `${outputName}.png`;
		
		// Set the path to the phantomjs binary
		var phantomPath = path.join(__dirname, 'phantomjs');
	
		const cmd = `${phantomPath} ./svgfltr.js '${svgs}' '${html}' /tmp/${targetHash}.png  ${screenWidth} ${screenHeight} ${timeout}`; // eslint-disable-line max-len
		// console.log(cmd);
		
		// Launc the child process
		exec(cmd, async (error, stdout, stderr) => {
			
			if (error) {
				// the command failed (non-zero), fail the entire call
				console.warn(`exec error: ${error}`, stdout, stderr);
				context.fail(error);
				return;
			}
			if (stderr) {
				console.log('error 1: ', stderr);
				context.fail(error);
				return;
			}
	
			// snapshotting succeeded, let's upload to S3
			  // read the file into buffer (perhaps make this async?)
			const fileBuffer = fs.readFileSync(`/tmp/${targetHash}.png`);
	
			  // upload the file
			  const s3 = new AWS.S3();
			  await s3.putObject({
				ACL: 'public-read',
				Key: targetFilename,
				Body: fileBuffer,
				Bucket: targetBucket,
				ContentType: 'image/png',
			  }).promise()
			  .then(data => {
				console.log('complete:PUT Object',data);
	
				cb(null, {
				  hash: targetHash,
				  key: `${targetFilename}`,
				  bucket: targetBucket,
				  url: `https://s3.amazonaws.com/${targetBucket}/${targetFilename}`
				});
			  })
			  .catch(err => {
				console.warn('error in put to s3');
				console.warn(err);
				  cb(err);
			  }); 
			  console.warn('at the end');
	
			  
			  context.succeed(stdout);
		});
	})
	
}