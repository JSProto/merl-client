const PORT = 8181;

const http = require('http');
const url = require('url');
const querystring = require('querystring');

const VBox = require('./vbox');

VBox.debug = true;

let router = {
	start: function(req, res) {

		let name = req.query.name;

		VBox.factory(name).start()
			.then(out => {
				let response = {success: false};

				if (out.includes('successfully started')) {
					response.success = true;
				}
				else {
					response.message = 'Unknown error';
				}

				res.json(response);
			})
			.catch(e => {

				let response = {
					success: false,
					message: e.message
				};

				if (e.message.includes('is already locked')) {
					response.success = true;
				}

				res.json(response);
			});
	},
	stop: function(req, res) {
		let name = req.query.name;

		VBox.factory(name).stop()
			.then(() => res.json({success: true}))
			.catch(e => {
				let response = {
					success: false,
					message: e.message
				};

				if (e.message.includes('is not currently running')) {
					response.success = true;
				}

				res.json(response);
			});
	},
	state: function(req, res) {

		let name = req.query.name;

		VBox.factory(name).info().then(function(info) {
			res.json({
				success: true,
		        state: info.VMState,
		        time: info.VMStateChangeTime
			});
		}).catch(function(e) {
			res.json({
				success: false,
				message: e.message
			});
		});
	},
	list: function(req, res) {
		VBox.list().then(Object.values).then(function(vms) {

			vms.forEach(vm => vm.state = vm.running);

			res.json({
				success: true,
				list: vms
			});

		}).catch(function(e) {

			res.json({
				success: false,
				message: e.message
			});
		});
	}
};

http.createServer(server).listen(PORT);
console.log('start server on port', PORT);


////// LIB

function server(request, response) {
	let {headers, method} = request;
	let {pathname, query} = url.parse(request.url);
	query = querystring.parse(query);

	if (pathname == '/favicon.ico') {
		response.statusCode = 200;
		return response.end('');
	}

	request.on('error', err => {
		console.error('request', err);
		response.json({
			success: false,
			message: err.message
		});
	});

	response.on('error', err => {
		console.error('response', err);
		response.statusCode = 500;
		response.json({
			success: false,
			message: err.message
		});
	});

	request.query = query;

	if (query.action in router) {
		try {
			response.statusCode = 200;
			router[query.action](request, response);
		} catch (err) {
			console.log(err);
			response.statusCode = 500;
			response.json({
				success: false,
				message: err.message
			});
		}
	}
	else {
		response.statusCode = 404;
		response.json({
			success: false,
			message: `action '${query.action}' not found`
		});
	}
}


http.ServerResponse.prototype.json = function(object) {
	this.setHeader('Content-Type', 'application/json');
	return this.end(JSON.stringify(object));
};


