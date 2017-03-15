
const exec = require('child_process').exec;

const OS_TYPE = {
	WINDOWS: 'windows',
	MAC: 'mac',
	LINUX: 'linux'
};

let escapeArg = function (arg) {
    if (!/\s|[\\"]]/.test(arg)) return arg;
    return arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};
// JSON.stringify()
const vBoxManageBinary = (function(platform){
	if (/^win/.test(platform)) {
		escapeArg = function (arg) {
		    if (!/\s|[\\"]]/.test(arg)) return arg;
		    return '"' + arg.replace(/"/g, '"""') + '"';
		};

		let vBoxInstallPath = process.env.VBOX_INSTALL_PATH || process.env.VBOX_MSI_INSTALL_PATH;
		return '"' + vBoxInstallPath + '\\VBoxManage.exe' + '"';
	}

	if (/^darwin/.test(platform) || /^linux/.test(platform)) {
		return 'vboxmanage';
	}

	return 'vboxmanage';
})(process.platform);

Object.defineProperty(RegExp.prototype, 'match', {
	'value': function(string){
		let match, result = [];
		while (match = this.exec(string))
		    result.push(match);
		return result;
	},
	'configurable': true,
	'writable': true
});

function parse_listdata(stdout) {
	return stdout.split(/\r?\n/g)
		.map(line => line.match(/^"(.+)" \{(.+)\}$/))
		.filter(matches => matches && matches.length === 3)
		.reduce(function(data, matches){
			let key = matches[2].toString();
			let name = matches[1].toString();
			data[key] = {name};
			return data;
		}, {});
}

function parse_infodata(stdout){
	let rePair = /^\"?([^=\"]+)\"?=\"?([^=\"]+)\"?$/gm;
	let re = /([^\[]+)\[([^\]]+)/gm;

	let str = rePair.match(stdout).reduce(function(info, match){
		let [, key, val] = match;
		val = val.trim();
		if (val == '<not set>') val = null;

		if (key.includes('[')) {
			let re = /([^\[]+)\[([^\]]+)/gm;
			let [, parent, child] = re.exec(key);

			if (!info[parent]) {
				info[parent] = {};
			}

			info[parent][child] = val;
		}
		else {
			info[key] = val;
		}

		return info;
	}, {});

		// console.log(str)

	return str;
}

class VBox {
	constructor(vmname) {
		if (!vmname) throw new Error('VBox: virtual machine name not defined');
		this.name = vmname;
		this._fname = JSON.stringify(vmname);
		this._info = {};
	}

	get(key){
		if (key in this._info) {
			return this._info[key];
		}

		return undefined;
	}

	info() {
		return VBox.manage('showvminfo', this._fname, {machinereadable: true})
			.then(parse_infodata)
			.then(info => this._info = info);
	}

	pause() {
		return VBox.manage('controlvm', this._fname, 'pause');
	}

	reset() {
		return VBox.manage('controlvm', this._fname, 'reset');
	}

	resume() {
		return VBox.manage('controlvm', this._fname, 'resume');
	}

	start(useGui = false) {
		return VBox.manage('startvm', this._fname, {
			type: useGui ? 'gui' : 'headless'
		});
	}

	stop() {
		return VBox.manage('controlvm', this._fname, 'savestate');
	}

	savestate() {
		return this.stop();
	}

	poweroff() {
		return VBox.manage('controlvm', this._fname, 'poweroff');
	}

	acpiPowerButton() {
		return VBox.manage('controlvm', this._fname, 'acpipowerbutton');
	}

	acpiSleepButton() {
		return VBox.manage('controlvm', this._fname, 'acpisleepbutton');
	}

	isRunning() {
		return VBox.manage('list', 'runningvms').then(stdout => stdout.indexOf(this._fname) !== -1);
	}

	snapshotList() {

		return new Promise((resolve, reject) => {

			VBox.manage('snapshot', this._fname, 'list', {machinereadable: true}).then(stdout => {

				let s;
				let snapshots = [];
				let currentSnapshot;
				let lines = (stdout || '').split('\n');
				let re = /^(CurrentSnapshotUUID|SnapshotName|SnapshotUUID).*\="(.*)"$/;

				lines.forEach(function(line) {
					line.replace(re, function(l, k, v) {
						if (k === 'CurrentSnapshotUUID') {
							currentSnapshot = v;
						}
						else if (k === 'SnapshotName') {
							s = {
								'name': v
							};
							snapshots.push(s);
						}
						else {
							s.uuid = v;
						}
					});
				});

				resolve(snapshots, currentSnapshot);
			}).catch(err => {

				if (err && /does not have any snapshots/.test(err.stdout)) {
					return resolve([], null);
				}

				return reject(err);
			});
		});
	}

	snapshotTake(name, description = null, live = false, options = {}) {
		let cmd = ['snapshot', this._fname, 'take', JSON.stringify(name)];

		if (description) {
			options['description'] = description;
		}

		if (live === true) {
			options['live'] = true;
		}

		cmd.push(options);

		return VBox.manage(...cmd).then(stdout => {
			let uuid;
			stdout.trim().replace(/UUID\: ([a-f0-9\-]+)$/, (l, u) => {uuid = u});
			return uuid;
		});
	}

	snapshotDelete(uuid) {
		return VBox.manage('snapshot', this._fname, 'delete', uuid);
	}

	snapshotRestore(uuid) {
		return VBox.manage('snapshot', this._fname, 'restore', uuid);
	}

	keyboardPutScanCode(codes) {
		let codeStr = codes.map(function(code) {
			let s = code.toString(16);
			return (s.length === 1 ? '0' + s : s);
		}).join(' ');

		return VBox.manage('controlvm', this._fname, 'keyboardputscancode', codeStr);
	}

	os() {
		if (this._os) {
			return Promise.resolve(this._os);
		}

		return this.info().then(info => {

			if (info.ostype.indexOf('Windows') !== -1) {
				this._os = OS_TYPE.WINDOWS;
			}
			else if (info.ostype.indexOf('MacOS') !== -1) {
				this._os = OS_TYPE.MAC;
			}
			else {
				this._os = OS_TYPE.LINUX;
			}

			console.log('Detected guest OS as: ' + this._os);

			return this._os;

		}).catch(e => console.error('Could not showvminfo for %s', this._fname));
	}


	/**
	 * @param {String} propName
	 * @returns {Promise.<String?>}
	 */
	getProperty(propName){
		return VBox.manage('guestproperty', 'get', this._fname, propName).then(stdout => {

			let value = stdout.substr(stdout.indexOf(':') + 1).trim();
			if (value === 'No value set!') {
				value = undefined;
			}

			return value;
		});
	}

	/**
	 * @param {String} propName
	 * @param {String} value
	 * @param {Object?} options
	 * @returns {Promise.<{stdout, stderr}>}
	 */
	setProperty(propName, value, options) {
	    return VBox.manage('guestproperty', 'set', this._fname, propName, value, options);
	}

	/**
	 * @param {String} propName
	 * @returns {Promise.<{stdout, stderr}>}
	 */
	deleteProperty(propName) {
	    return VBox.manage('guestproperty', 'delete', this._fname, propName);
	}

	exec(options) {
		let exec = options.exec,
			args = options.args,

			username = `--username ` + (options.user || 'Guest'),
			password = (options.pass ? ' --password ' + options.pass : '');

		if (Array.isArray(args)) {
			args = args.join(" ");
		}

		if (args === undefined) {
			args = '';
		}


		// args.push('--exe', shell, '--', /* arg0 */ 'cmd.exe', /* arg1 */ '/c');
		return this.os().then(os => {
			let runv = (VBox.version == 5 ? 'run' : 'execute  --image');
			let shell = '';

			if (os == OS_TYPE.WINDOWS) {
				exec = exec.replace(/\\/g, '\\\\');
				shell = 'cmd.exe';
			}
			else if (os == OS_TYPE.MAC) {
				shell = '/usr/bin/open -a';
			}
			else if (os == OS_TYPE.LINUX) {
				shell = '/bin/sh';
			}

			return VBox.manage('guestcontrol', this._fname, runv, shell, username, password, `-- "/c" "${exec}" "${args}"`);
		});
	}

	/**
	 * @param {String} process
	 * @param {String?} options
	 * @returns {Promise.<{stdout, stderr}>}
	 */
	kill(process, options = {}) {
		// let cmd = 'guestcontrol "${this._fname}" process kill';

		options = Object.assign({
			'no-wait-stdout': true, // FIX
			'no-wait-stderr': true,
		}, options);

		if (!process) {
			throw new Error('VBox.kill: options.process not defined');
		}

		options.args = [options.process];

		return this.os().then(os => {
			switch (os) {
				case OS_TYPE.WINDOWS:
					options.exec = '%SystemRoot%\\System32\\taskkill.exe /im';
					break;

				case OS_TYPE.MAC:
				case OS_TYPE.LINUX:
				default:
					options.exec = 'sudo killall';
					break;
			}

			return this.exec(options);
		});
	}


	/**
	 * Call a VBoxManage command
	 * @param {String} command
	 * @param {String?} arguments
	 * @param {Object?} options
	 * @returns {Promise<{stdout, stderr}>}
	 */
	static manage(...command) {

		let options = command.pop();

		if (typeof options !== 'object') {
			command.push(options);
			options = {};
		}

	    Object.keys(options).forEach(function (option) {

	        let value = options[option];
	        command.push('--' + option);

	        if (value !== true) {
	            command.push(escapeArg(value));
	        }
	    });

	    if (VBox.debug) {
	    	// if (command.includes('guestcontrol'))
	        console.warn('$ VBoxManage ' + command.join(' '));
	    }

	    command.unshift(vBoxManageBinary);

		return new Promise(function(resolve, reject) {

			exec(command.join(' '), {}, function(err, stdout, stderr) {


				if (err && /VBOX_E_INVALID_OBJECT_STATE/.test(err.message)) {
					err = undefined;
				}

				if (!err && stderr
					&& command.includes("pause")
					&& command.includes("savestate")
					&& command.includes("poweroff")) {
					err = new Error(stderr);
				}

				if (err) {
					err.stdout = stdout;
					err.stderr = stderr;
	        		console.warn('$ VBoxManage unknown error')
					console.error(err);
				}

				return (err ? reject(err) : resolve(stdout));
			});
		});
	}

	static list() {
		return VBox.manage('list', 'runningvms').then(parse_listdata).then(runningvms => {
			return VBox.manage('list', 'vms').then(parse_listdata).then(vms => {
				Object.keys(vms).map(key => vms[key].running = key in runningvms);
				return vms;
			});
		});
	}

	static getBreakCode(key) {
		let makeCode = VBox.CODES[key];

		if (makeCode === undefined) {
			throw new Error('Undefined key: ' + key);
		}

		if (key === 'PAUSE') {
			return [];
		}

		if (makeCode[0] === 0xE0) {
			return [0xE0, makeCode[1] + 0x80];
		}
		else {
			return [makeCode[0] + 0x80];
		}
	}

	static factory(name) {
		return new VBox(name);
	}

}


VBox.CODES = {

  'ESCAPE'          : [0x01],
  'NUMBER_1'        : [0x02],
  'NUMBER_2'        : [0x03],
  'NUMBER_3'        : [0x04],
  'NUMBER_4'        : [0x05],
  'NUMBER_5'        : [0x06],
  'NUMBER_6'        : [0x07],
  'NUMBER_7'        : [0x08],
  'NUMBER_8'        : [0x09],
  'NUMBER_9'        : [0x0A],
  'NUMBER_0'        : [0x0B],
  'MINUS'           : [0x0C],
  'EQUAL'           : [0x0D],
  'BACKSPACE'       : [0x0E],
  'TAB'             : [0x0F],

  'Q'               : [0x10],
  'W'               : [0x11],
  'E'               : [0x12],
  'R'               : [0x13],
  'T'               : [0x14],
  'Y'               : [0x15],
  'U'               : [0x16],
  'I'               : [0x17],
  'O'               : [0x18],
  'P'               : [0x19],
  'LEFTBRACKET'     : [0x1A],
  'RIGHTBRACKET'    : [0x1B],
  'ENTER'           : [0x1C],
  'CTRL'            : [0x1D],
  'A'               : [0x1E],
  'S'               : [0x1F],

  'D'               : [0x20],
  'F'               : [0x21],
  'G'               : [0x22],
  'H'               : [0x23],
  'J'               : [0x24],
  'K'               : [0x25],
  'L'               : [0x26],
  'SEMICOLON'       : [0x27],
  'QUOTE'           : [0x28],
  'BACKQUOTE'       : [0x29],
  'SHIFT'           : [0x2A],
  'BACKSLASH'       : [0x2B],
  'Z'               : [0x2C],
  'X'               : [0x2D],
  'C'               : [0x2E],
  'V'               : [0x2F],

  'B'               : [0x30],
  'N'               : [0x31],
  'M'               : [0x32],
  'COMMA'           : [0x33],
  'PERIOD'          : [0x34],
  'SLASH'           : [0x35],
  'R_SHIFT'         : [0x36],
  'PRT_SC'          : [0x37],
  'ALT'             : [0x38],
  'SPACE'           : [0x39],
  'CAPS_LOCK'       : [0x3A],
  'F1'              : [0x3B],
  'F2'              : [0x3C],
  'F3'              : [0x3D],
  'F4'              : [0x3E],
  'F5'              : [0x3F],

  'F6'              : [0x40],
  'F7'              : [0x41],
  'F8'              : [0x42],
  'F9'              : [0x43],
  'F10'             : [0x44],
  'NUM_LOCK'        : [0x45], // May be [0x45, 0xC5],
  'SCROLL_LOCK'     : [0x46],
  'NUMPAD_7'        : [0x47],
  'NUMPAD_8'        : [0x48],
  'NUMPAD_9'        : [0x49],
  'NUMPAD_SUBTRACT' : [0x4A],
  'NUMPAD_4'        : [0x4B],
  'NUMPAD_5'        : [0x4C],
  'NUMPAD_6'        : [0x4D],
  'NUMPAD_ADD'      : [0x4E],
  'NUMPAD_1'        : [0x4F],

  'NUMPAD_2'        : [0x50],
  'NUMPAD_3'        : [0x51],
  'NUMPAD_0'        : [0x52],
  'NUMPAD_DECIMAL'  : [0x53],
  'F11'             : [0x57],
  'F12'             : [0x58],

  // Same as other Enter key
  // 'NUMBER_Enter'    : [0xE0, 0x1C],
  'R_CTRL'          : [0xE0, 0x1D],

  'NUMBER_DIVIDE'   : [0xE0, 0x35],
  //
  // 'NUMBER_*'        : [0xE0, 0x37],
  'R_ALT'           : [0xE0, 0x38],

  'HOME'            : [0xE0, 0x47],
  'UP'              : [0xE0, 0x48],
  'PAGE_UP'         : [0xE0, 0x49],
  'LEFT'            : [0xE0, 0x4B],
  'RIGHT'           : [0xE0, 0x4D],
  'END'             : [0xE0, 0x4F],

  'DOWN'            : [0xE0, 0x50],
  'PAGE_DOWN'       : [0xE0, 0x51],
  'INSERT'          : [0xE0, 0x52],
  'DELETE'          : [0xE0, 0x53],
  'WINDOW'          : [0xE0, 0x5B],
  'R_WINDOW'        : [0xE0, 0x5C],
  'MENU'            : [0xE0, 0x5D],

  'PAUSE'           : [0xE1, 0x1D, 0x45, 0xE1, 0x9D, 0xC5]
};

VBox.manage({version:true}).then(stdout => String(stdout.split(".")[0]).trim()).then(version => {
	VBox.version = version;
	console.info(`Virtualbox version detected as ${version}`);
});

module.exports = VBox;
