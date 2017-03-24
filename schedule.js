
const schedule = require('pomelo-schedule');
const moment = require('moment');
// const VBox = require('./vbox-emulator');
const VBox = require('./vbox');

VBox.debug = false;

let limitStartedVM = 2;                     // counts
let workTime = 2 * 60 * 1000;              // minutes
let startDelayBetweenVM = 0.5 * 60 * 1000;    // minutes

function getListVM() {
    return VBox.list().then(Object.values).then(list => {
        let vms = list.map(v => VBox.factory(v.name));
        return vms.reduce((sequence, vm) => sequence.then(() => vm.info()), Promise.resolve())
            .then(() => vms.filter(vm => vm.get('groups') == '/'));
    });
}

function sortVM (vm1, vm2) {
    let t1 = new Date(vm1.get('VMStateChangeTime'));
    let t2 = new Date(vm2.get('VMStateChangeTime'));

    return t1 > t2 ? 1 : t1 < t2 ? -1 : 0;
}

let startJob = function(vm, i) {

    // start vm
    let timeStart = i * startDelayBetweenVM; // star time
    let startName = 'start ' + vm.name;

    let job = function(data) {
        try {
            let date = (new Date()).toISOString();
            console.log(`${date}: run job: ${data.name}`);

            vm.start().then(() => stopJob(vm)).catch(err => {
                console.error(`ERROR: start vm ${vm.name}`);
                console.error(err.message);
            });
        }
        catch (e) {
            console.error(`ERROR: start job vm ${vm.name}`);
            console.log(e.message)
        }
    }

    schedule.scheduleJob({
        start: Date.now() + timeStart
    }, job, {name: startName, vm});
}


let stopJob = function(vm) {

    let timeStop = workTime; // work time
    let stopName = 'stop ' + vm.name;
    let job = function(data) {
        try {
            let date = (new Date()).toISOString();
            console.log(`${date}: run job: ${data.name}`);

            // stop logic and try start next vm

            vm.poweroff().catch(err => {
                console.error(`ERROR: stop vm ${vm.name}`);
                console.error(err.message);
            }).then(() => {
                console.log('wait start after 5 sec');
                setTimeout(start, 5000);
            });
        }
        catch (e) {
            console.error(`ERROR: stop job vm ${vm.name}`);
            console.log(e.message)
        }
    }

    schedule.scheduleJob({
        start: Date.now() + timeStop
    }, job, {name: stopName, vm});
}


function start() {

    getListVM().then(vms => {

        try {
            let running = vms.filter(vm => vm.get('VMState') == 'running').length;

            vms.sort(sortVM);

            let toRunVMS = vms.filter(vm => vm.get('running') != 'running').slice(0, limitStartedVM - running);

            console.log('running', running, toRunVMS.length);


            toRunVMS.map(startJob);
        }
        catch (e) {
            console.error(`ERROR: start`);
            console.log(e.message)
        }

    }).catch(e => {
        console.error('ERROR: list vm');
        console.error(e.message);
    });

}


start();