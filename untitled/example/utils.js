//The main logic of this service.  #WJ,201903
const fs = require('fs'),
    path = require('path'),
    moment = require('moment'),
    postES = require('../logger/postES'),
    writeLogger = require('../logger/writeLogger'),
    Client = require('fabric-client');

Client.addConfigFile(path.join(__dirname, '../config.json'));
var client = Client.loadFromConfig(path.join(__dirname, '../network.json')),
    clientStore = client.getConfigSetting("clientStore"),
    userKeyPath = path.join(__dirname, clientStore.userKey),
    adminKeyPath = path.join(__dirname, clientStore.adminKey),
    clientCertPath = path.join(__dirname, clientStore.clientCert);

// Constructor  #WJ,201903
function clientUtils() {
    this.restClient = null;
    let self = this;
    this.clients = async function () {
        let rs = await Promise.all([this.prepareClient(), this.initChannel()]);
        // console.log(rs[1].getPeersForOrg())
        this.restClient = { // when your client working in multiple channel on the network , use parameter instead of this.restClient #WJ,201904
            currChannel: rs[1],
            targetPeers: rs[1].getPeersForOrg(),
            eventHub: rs[1].getChannelEventHubsForOrg()
        };
    };

    this.initLoadUser = async function (user) {
        let keyPath = user === "admin" ? adminKeyPath : userKeyPath; //'admin' or 'user'  #WJ,201903
        let stateStore = await Client.newDefaultKeyValueStore({
            path: keyPath
        });
        client.setStateStore(stateStore);
        let cryptoSuite = Client.newCryptoSuite();
        let cryptoStore = Client.newCryptoKeyStore({
            path: keyPath
        });
        cryptoSuite.setCryptoKeyStore(cryptoStore);
        client.setCryptoSuite(cryptoSuite);
        return await client.getUserContext(user, true);
    };
    this.initSetTls = async function () {
        let keyData = fs.readFileSync(clientCertPath + 'client.key');
        let certData = fs.readFileSync(clientCertPath + 'client.crt');
        let tlsKey = Buffer.from(keyData).toString();
        let tlsCert = Buffer.from(certData).toString();
        return await client.setTlsClientCertAndKey(tlsCert, tlsKey);
    };
    this.prepareClient = async function () {
        let clientUser = client.getConfigSetting("clientUser");
        let loadUser = await this.initLoadUser(clientUser);
        //check the loadUser is exist.......(pass)********************************************************************************* #WJ,201903
        return Promise.all([this.initSetTls(), client.getUserContext(clientUser, true)]);
    };
    this.initChannel = async function () {
        let channelName = client.getConfigSetting("defaultChannel");
        let channel = client.getChannel(channelName);
        return channel;
        // admin can use service discovery(pass)********************************************************************************* #WJ,201903
    };

    this.queryChain = async function (uuId, channel, request) { //uuId, channel, request #WJ,201908,v2
        let sentTime = this.writeLog('info', uuId, ``, ``, `txStep SDK_CC_SND ${client['_network_config']['_network_config'].name} ${channel.getName()}}`, `{network:"${client['_network_config']['_network_config'].name}",channel:"${channel.getName()}"}`, ``);
        let queryRS = await channel.queryByChaincode(request);
        let queryPromise = new Promise((resolve, reject) => {
            if (queryRS && queryRS.length == 1) {
                let queryChainRS = JSON.parse(queryRS); // stringify json return from chaincode  #WJ,201903
                queryChainRS['SDK_CC_SND'] = sentTime;
                queryChainRS['SDK_CC_REC'] = this.writeLog('info', uuId, ``, ``, `txStep SDK_CC_REC`, ``, ``); ///for log use only #WJ,201904
                if (queryRS[0] instanceof Error) {
                    reject(new Error(`{status:"FAIL",Info:"error from query: ${queryRS[0]}"}`));
                } else {
                    resolve(queryChainRS);
                }
            } else {
                reject(new Error(`{status:"FAIL",Info:"No payloads were returned from query"}`));
            }
        });

        return queryPromise.then(function (queryResponses) {
                return queryResponses;
            })
            .catch(function (error) {
                return error;
            });
    };

    this.invokeChain = async function (uuId, channel, request) {
        let sendTime = this.writeLog('info', uuId, ``, `${request.txId._transaction_id}`, `txStep SDK_CC_SND ${client['_network_config']['_network_config'].name} ${channel.getName()} ${request.txId._transaction_id}`, `{network:"${client['_network_config']['_network_config'].name}",channel:"${channel.getName()}"}`, ``);
        return await this.makeProposal(uuId, channel, request)
            .then(function (proposalRS) {
                let rsTime = self.writeLog('info', uuId, ``, ``, `txStep SDK_CC_REC`, ``, ``);
                console.log(proposalRS);
                if (proposalRS.proposalResponses && proposalRS.proposalResponses[0].response &&
                    proposalRS.proposalResponses[0].response.status === 200) {
                    return Promise.all([self.submitTx(uuId, channel, proposalRS), self.txEvent(uuId, request.txId._transaction_id)])
                        .then((invokeRS) => {
                            let obj = Object.assign(invokeRS[0], invokeRS[1]);
                            obj['SDK_CC_SND'] = sendTime;
                            obj['SDK_CC_REC'] = rsTime;
                            return obj;
                        });
                } else {
                    console.log('Error:'+proposalRS);

                    //console.log(proposalRS.proposalResponses[0]); this is the error messsage. #WJ,201903
                    return new Error(`{'SDK_CC_SND':"${sendTime}",status:"FAIL",Info:"Transaction proposal was bad -${proposalRS.proposalResponses[0]}"}`);
                }
            })
    };

    this.makeProposal = async function (uuId, channel, request) {
        return await channel.sendTransactionProposal(request)
            .then(function (proposalResult) {
                return proposalRS = {
                    proposalResponses: proposalResult[0], //a array of ProposalResponse objects from the endorsing peers which you called #WJ,201904
                    proposal: proposalResult[1]
                } //the original Proposal object #WJ,201904};
            })
            .catch(function (error) {
                return new Error(`{status:"Error",Info:"${error}"}`);
            });
    };

    this.submitTx = async function (uuId, channel, proposalRS) {
        let commitRequest = { // build up the request for the orderer to have the transaction committed #WJ,201903
            proposalResponses: proposalRS.proposalResponses,
            proposal: proposalRS.proposal
        };
        let sendTime = this.writeLog('info', uuId, ``, ``, `txStep SDK_OSN_SUBM`, ``, ``);
        return sendRS = channel.sendTransaction(commitRequest)
            .then(function (sendRS) {
                sendRS['SDK_OSN_SUBM'] = sendTime;
                sendRS['SDK_OSN_RTN'] = self.writeLog('info', uuId, ``, ``, `txStep SDK_OSN_RTN`, `{status:"${sendRS.status}",info:"${sendRS.info}"}`, ``);
                return sendRS;
            })
            .catch(function (error) {
                return new Error(`{SDK_OSN_SUBM:"${sendTime}",status:"Error",Info:"${error}"}`);
            });
    }

    this.txEvent = function (uuId, txID) {
        let eventHub = this.restClient.eventHub[0];
        let txPromise = new Promise((resolve, reject) => {
            let handle = setTimeout(() => {
                eventHub.disconnect();
                reject({
                    "eventStatus": "TIMEOUT",
                    "txID": txID
                }); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
            }, 8000);
            eventHub.connect();
            eventHub.registerTxEvent(txID, (tx, status) => { //(Transaction id string or 'all',onevent(txid,status:VALID or ...))
                clearTimeout(handle); // first some clean up of event listener
                eventHub.unregisterTxEvent(txID);
                eventHub.disconnect();
                let returnStatus = {
                    "eventStatus": status,
                    "txID": txID
                }; //status = 'VALID' while success.
                if (status !== 'VALID') {
                    reject(returnStatus);
                } else {
                    resolve(returnStatus);
                }
            }, (err) => {
                reject({
                    "eventStatus": err,
                    "txID": txID
                }); //this is the callback if something goes wrong with the event registration or processing
            });
        });
        return txPromise
            .then(function (returnStatus) {
                let txEvent = { // build up the request for the orderer to have the transaction committed #WJ,201903
                    SDK_EVENT_STAT: returnStatus.eventStatus,
                    SDK_EVENT_RTN: self.writeLog('info', uuId, ``, ``, `txStep SDK_EVENT_RTN ${returnStatus.eventStatus}`, `{status:"${returnStatus.eventStatus}"}`, ``)
                };
                return txEvent;
            })
            .catch(function (returnStatus) {
                let txEvent = { // build up the request for the orderer to have the transaction committed #WJ,201903
                    SDK_EVENT_STAT: returnStatus.eventStatus,
                    SDK_EVENT_RTN: self.writeLog('info', uuId, ``, ``, `txStep SDK_EVENT_RTN ${returnStatus.eventStatus}`, `{status:"${returnStatus.eventStatus}"}`, ``)
                };
                writeLogger.error(`[${uuId}  ] [issue error ${uuId}] :  : ${JSON.stringify(txEvent)}`);
                return txEvent;
            });
    };

    ///for log use only #WJ,201903
    this.writeLog = function (levelType, uuId, commId, txId, logLabel, logBody, logMessage) {
        let writeStr = `[${uuId} ${commId} ${txId}] [${logLabel}] : ${logBody} : ${logMessage}`;
        writeLogger[levelType](writeStr);
        return moment().format('YYYY-MM-DD HH:mm:ss.SSS Z');
    };
    // this.writeLog = function(levelType,uuId,commId, txId, logLabel, logBody, logMessage) {
    //     let writeStr = `[${uuId} ${commId} ${txId}] [${logLabel}] : ${logBody} : ${logMessage}`;
    //     writeLogger[levelType](writeStr);
    //     let times = moment().format('YYYY-MM-DD HH:mm:ss.SSS Z');
    //     let isoTimes = new Date(times).toISOString();
    //     let postBody = {d_uuid:uuId,d_commid:commId,d_txid:txId,d_level:levelType,d_label:logLabel,d_body:logBody,d_message:logMessage,d_times:isoTimes};
    //     //postES.postMe('peganetwork-2020.01',postBody);
    //     return times};
}


// prototype
clientUtils.prototype.goQuery = async function (uuId, chainId, queryFunc, queryArgs) { //uuId, chaincodeID, chainFnc, queryArgs #WJ,201908,v2
    let request = {
        targets: this.restClient.targetPeers[0], //the first peers assigned to the org #WJ,201904
        chaincodeId: chainId,
        args: [JSON.stringify(queryArgs)],
        fcn: queryFunc
    }; //stringify for chaincodes #WJ,201908,v2
    return await this.queryChain(uuId, this.restClient.currChannel, request); //uuId, channel, request #WJ,201908,v2
};

clientUtils.prototype.goInvoke = async function (uuId, chainId, queryFunc, invokeArgs) { //uuId, chaincodeID, chainFnc, invokeArgs #WJ,201908,v2
    let request = {
        targets: this.restClient.targetPeers, //all the peers assigned to the org #WJ,201904
        chaincodeId: chainId,
        fcn: queryFunc,
        args:  [JSON.stringify(invokeArgs)],
        txId: client.newTransactionID()
    };
    return await this.invokeChain(uuId, this.restClient.currChannel, request);
};


module.exports = clientUtils;
