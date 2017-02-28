'use strict';

var _ = require('lodash')
  , q = require('q')
  , defaultConfig = require('./config')
  , Rx = require('rx')
  ;

var $fh, initialized = false, notificationStream, listeners = [];

function transformDataSet(syncData) {
  var result = _.values(syncData).map(function(syncData) {
    return syncData.data;
  });
  return _.sortBy(result, function(o) {
    return o.id;
  });
}

function formatError(code, msg) {
  var error = 'Error';
  if (code && msg) {
    error += ' ' + code + ': ' + msg;
  } else if (code && !msg) {
    error += ': ' + code;
  } else if (!code && msg) {
    error += ': ' + msg;
  } else {
    error += ': no error details available';
  }
  return error;
}

/**
 * Function to check whether a notifcation from the $fh.sync API is relevant.
 * @param {object} notification            - a $fh.sync Notifcation
 * @param {object} comparison              - a comparison notification object
 * @param {string} comparison.code         - The $fh.sync notification code that is relevant
 * @param {string} comparison.message      - The $fh.sync notification message that is relevant
 * @param {string} comparison.uid          - A Unique identifier for the synchronised document
 * @returns {boolean}
 */
function isNotificationRelevant(notification, comparison) {

  //The cached UID of the object may have changed in the sync framework from an update from the server.
  //This updated uid is used for document notifications
  //This call ensure that the correct document uid is used.
  comparison.uid = $fh.sync && $fh.sync.getUID ? $fh.sync.getUID(comparison.uid) : comparison.uid;

  if (comparison.code && notification.code !== comparison.code) {
    return false;
  }

  if (comparison.message && notification.message !== comparison.message) {
    return false;
  }

  if (comparison.uid && notification.uid !== comparison.uid) {
    return false;
  }

  return true;
}

function init(_$fh, _syncOptions) {
  if (initialized) {
    console.log('sync-client already initalized.');
  } else {
    console.log('sync-client initalizing.');
    $fh = _$fh;
    notificationStream = Rx.Observable.create(function(observer) {
      addListener(function(notification) {
        observer.onNext(notification);
      });
    })
    .share();
    var syncOptions = _.defaults(_syncOptions, defaultConfig.syncOptions);

    $fh.sync.init(syncOptions);
    initialized = true;
    $fh.sync.notify(function(notification) {
      listeners.forEach(function(listener) {
        listener.call(undefined, notification);
      });
    });
  }
}

function manage(datasetId, options, queryParams, metaData) {
  var deferred = q.defer();
  if (!initialized) {
    deferred.resolve('Sync not yet initialized.  Call sync-client.init() first.');
  } else {
    //manage the dataSet
    $fh.sync.manage(datasetId, options, queryParams, metaData, function() {
      var manager = new DataManager(datasetId);
      manager.stream = notificationStream.filter(function(notification) {
        return notification.dataset_id === datasetId;
      });
      deferred.resolve(manager);
    });
  }
  return deferred.promise;
}

function addListener(listener) {
  listeners.push(listener);
}

function DataManager(datasetId) {
  this.datasetId = datasetId;
}

DataManager.prototype.list = function() {
  var deferred = q.defer();
  $fh.sync.doList(this.datasetId, function(res) {
    var objects = transformDataSet(res);
    deferred.resolve(objects);
  }, function(code, msg) {
    deferred.reject(new Error(formatError(code, msg)));
  });
  return deferred.promise;
};

DataManager.prototype.create = function(object) {
  var deferred = q.defer();
  var self = this;
  $fh.sync.doCreate(self.datasetId, object, function(msg) {
    // success
    self.stream.filter(function(notification) {
      return isNotificationRelevant(notification, {
        code: 'local_update_applied',
        message: 'create'
      });
    }).take(1).toPromise(q.Promise)
    .then(function() {
      object._localuid = msg.uid;
      return self.update(object);
    })
    .then(function(result) {
      deferred.resolve(result);
    });
  }, function(code, msg) {
    // failure
    deferred.reject(new Error(formatError(code, msg)));
  });
  return deferred.promise;
};

DataManager.prototype.read = function(id) {
  var deferred = q.defer();
  $fh.sync.doRead(this.datasetId, id, function(res) {
    // success
    deferred.resolve(res.data);
  }, function(code, msg) {
    // failure
    deferred.reject(new Error(formatError(code, msg)));
  });
  return deferred.promise;
};

DataManager.prototype.update = function(object) {
  var deferred = q.defer();
  var self = this;
  var uidPromise = _.has(object, 'id')
    ? q.when(String(object.id))
    : self.read(object._localuid).then(function(_object) {
      console.log('_object', _object);
      if (_.has(_object, 'id')) {
        object.id = _object.id;
        return String(_object.id);
      } else {
        return object._localuid;
      }
    });
  uidPromise.then(function(uid) {
    console.log('updating with id', uid);
    $fh.sync.doUpdate(self.datasetId, uid, object, function() {
    // success
      self.stream.filter(function(notification) {
        return isNotificationRelevant(notification, {
          code: 'local_update_applied',
          messag: 'update',
          uid: uid
        });
      }).take(1).toPromise(q.Promise)
    .then(function() {
      return self.read(uid);
    })
    .then(function(result) {
      console.log('result', result);
      deferred.resolve(result);
    });
    }, function(code, msg) {
    // failure
      console.error('Error updating', object);
      deferred.reject(new Error(formatError(code, msg)));
    });
  });
  return deferred.promise;
};

DataManager.prototype.delete = function(object) {
  var deferred = q.defer();
  var self = this;
  $fh.sync.doDelete(self.datasetId, object.id, function() {
    // success
    var uid = String(object.id);
    self.stream.filter(function(notification) {
      return isNotificationRelevant(notification, {
        code: 'local_update_applied',
        message: 'delete',
        uid: uid
      });
    }).take(1).toPromise(q.Promise)
    .then(function(notification) {
      deferred.resolve(notification.message);
    });
  }, function(code, msg) {
    // failure
    deferred.reject(new Error(formatError(code, msg)));
  });
  return deferred.promise;
};

DataManager.prototype.start = function() {
  var deferred = q.defer();
  $fh.sync.startSync(this.datasetId, function() {
    deferred.resolve('sync loop started');
  }, function(error) {
    deferred.reject(error);
  });
  return deferred.promise;
};

DataManager.prototype.stop = function() {
  var deferred = q.defer();
  var self = this;
  $fh.sync.stopSync(this.datasetId, function() {
    if (self.recordDeltaReceivedSubscription) {
      self.recordDeltaReceivedSubscription.dispose();
    }
    deferred.resolve('sync loop stopped');
  }, function(error) {
    deferred.reject(error);
  });
  return deferred.promise;
};

DataManager.prototype.forceSync = function() {
  var deferred = q.defer();
  $fh.sync.forceSync(this.datasetId, function() {
    deferred.resolve('sync loop will run');
  }, function(error) {
    deferred.reject(error);
  });
  return deferred.promise;
};

DataManager.prototype.getQueueSize = function() {
  var deferred = q.defer();
  $fh.sync.getPending(this.datasetId, function(pending) {
    deferred.resolve(_.size(pending));
  });
  return deferred.promise;
};

DataManager.prototype.safeStop = function(userOptions) {
  var deferred = q.defer();
  var defaultOptions = {
    timeout: 2000
  };
  var self = this;
  var options = _.defaults(userOptions, defaultOptions);
  self.getQueueSize()
  .then(function(size) {
    if (size === 0) {
      self.stop().then(deferred.resolve);
    } else {
      deferred.notify('Calling forceSync sync before stop');
      return self.forceSync()
      .then(self.waitForSync.bind(self))
      .timeout(options.timeout)
      .then(self.getQueueSize.bind(self))
      .then(function(size) {
        if (size > 0) {
          deferred.reject(new Error('forceSync failed, outstanding results still present'));
        }
      })
      .then(self.stop.bind(self))
      .then(function() {
        deferred.resolve();
      }, function() {
        deferred.reject(new Error('forceSync timeout'));
      });
    }
  });
  return deferred.promise;
};

DataManager.prototype.waitForSync = function() {
  var deferred = q.defer();
  var self = this;
  self.stream.filter(function(notification) {
    return notification.code === 'sync_complete' || notification.code === 'sync_failed';
  }).take(1).toPromise(q.Promise)
  .then(function(notification) {
    if (notification.code === 'sync_complete') {
      deferred.resolve(notification);
    } else if (notification.code === 'sync_failed') {
      deferred.reject(new Error('Sync Failed', notification));
    }
  });
  return deferred.promise;
};

DataManager.prototype.publishRecordDeltaReceived = function(mediator) {
  var self = this;
  self.recordDeltaReceivedSubscription = self.stream.filter(function(notification) {
    return notification.code === 'record_delta_received';
  }).subscribe(function(notification) {
    mediator.publish('wfm:sync:record_delta_received:' + self.datasetId, notification);
  });
};

module.exports = {
  init: init
, manage: manage
, addListener: addListener
};
