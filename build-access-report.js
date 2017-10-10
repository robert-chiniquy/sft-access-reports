#! /usr/bin/env node

const util = require('util');

const _ = require('underscore');
const async = require('async');
const moment = require('moment');
const request = require('request');
const parseLinks = require('parse-link-header');

const logmagic = require('logmagic');
if (process.env.DEBUG) {
    logmagic.route("__root__", logmagic.TRACE1, "console");
}
const log = logmagic.local('access-reporting');

const config = require('./config');

function main() {
    var sft = new ScaleFT(
        config.team,
        config.key,
        config.secret,
        config.instance
    );
    var since = moment().subtract(config.days, "days").toDate();

    log.debug('Reporting on server access events', {
        'since': since,
        'team': config.team,
        'instance': config.instance
    });

    sft.collectAuditsSince(since, function(err, audits) {
        if (err) {
            log.error('Error collecting audits', {
                'error': err
            });
            process.exit(1);
            return;
        }

        printReport(audits);

        process.exit(0);
    });
}

function printReport(audits) {
    // filter to only user_creds.issue
    var issueEvents = _.filter(audits.list, function selectIssueEvents(e) {
       if (e.details && e.details.type) {
           if (e.details.type === 'user_creds.issue') {
               return true;
           }
       }
       return false;
    });

    // build a record with human-readable strings from the related objects
    var accessEvents = _.map(issueEvents, function(e) {
        const when = e.timestamp;
        const user = audits.relatedObjects[e.details.actor].object.name;
        const project = audits.relatedObjects[e.details.project].object.name;
        const servers = _.map(e.details.servers, function(s) {
            return audits.relatedObjects[s].object.hostname;
        });

        return {
            when: when,
            user: user,
            project: project,
            servers: servers
        };
    });

    // group by project
    const grouped = _.groupBy(accessEvents, 'project');

    // then print simplified records with fields tab-delimited sorted by date within each project
    _.each(grouped, function(singleProject) {
        const sorted = _.sortBy(singleProject, 'when');
        _.each(sorted, function(e) {

            const record = util.format("%s\t%s\t%s\t%s",
                moment(e.when),
                e.project,
                e.user,
                e.servers
            );

            process.stdout.write(record + "\n");
        });
    });
}

var ScaleFT = function(team, key, secret, instance) {
    this.team = team;
    this.key = key;
    this.secret = secret;
    this.instance = instance || 'app.scaleft.com';
    this.token = '';
    this.tokenExpiration = 0;
};

ScaleFT.prototype.collectAuditsSince = function(since, callback) {
    var self = this;
    async.auto({
        refreshToken: this.refreshToken.bind(this),
        getEvents: ['refreshToken', function(results, callback) {
            self.getEvents(since, callback);
        }]
    }, function(err, results) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, results.getEvents);
    });
};

ScaleFT.prototype.refreshToken = function(callback) {
    var self = this;

    if (Date.now() < this.tokenExpiration) {
        callback();
        return;
    }

    const uri = this.urlFromPath('/service_token');

    request({
        uri: uri,
        method: 'POST',
        json: true,
        body: {
            key_id: this.key,
            key_secret: this.secret
        }
    }, function(err, msg, body) {
        if (err) {
            log.error('Error requesting /service_token', {
                'uri': uri,
                'error': err
            });
            callback(err);
            return;
        }
        if (body.code > 299) {
            err = body;
            log.error('Error from /service_token', {
                'uri': uri,
                'error': err
            });
            callback(err);
            return
        }

        self.token = body.bearer_token;
        self.tokenExpiration = Date.now() + 59 * 600 * 1000; // The token expires in 1 hour.

        callback();
    });
};

ScaleFT.prototype.getEvents = function(afterTime, callback) {
    var self = this;

    var qs = {
        descending: '1',
        count: 500
    };

    if (afterTime) {
        qs.after_time = afterTime;
    }

    const uri = this.urlFromPath('/auditsV2');
    var urls = [uri];
    var audits = {
        list: [],
        relatedObjects: []
    };

    async.until(function done() {
        return urls.length == 0;
    }, function getOne(callback) {
        const current = urls.shift();

        log.debug('Requesting a page of audits', {
            'uri': current,
            'collected': audits.list.length
        });

        request({
            uri: current,
            qs: qs,
            method: 'GET',
            json: true,
            auth: {
                bearer: self.token
            }
        }, function(err, msg, body) {
            if (err) {
                log.error('Error requesting audit events', {
                    'uri': uri,
                    'error': err,
                    'since': afterTime
                });
                callback(err);
                return;
            }
            if (body.code > 299 || _.isUndefined(body.list)) {
                err = body;
                log.error('Error retrieving audits', {
                    'uri': uri,
                    'error': err,
                    'since': afterTime
                });
                callback(err);
                return
            }

            var links = parseLinks(msg.headers.link);
            if (links.next) {
                urls.push(links.next.url);
            }

            audits.list = audits.list.concat(body.list);
            _.assign(audits.relatedObjects, body.related_objects);

            callback(null);
        });

    }, function(err) {
        if (err) {
            callback(err);
            return;
        }
        callback(null, audits);
    });
};

ScaleFT.prototype.urlFromPath = function(path) {
    return util.format('https://%s/v1/teams/%s%s', this.instance, this.team, path);
};

main();

