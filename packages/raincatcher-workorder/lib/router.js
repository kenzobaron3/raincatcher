'use strict';

var express = require('express'),
  config = require('./config');

//This is probably not needed anymore after using sync service
function initRouter(mediator) {
  var router = express.Router();

  router.route('/').get(function(req, res) {
    mediator.once('done:workorders:load', function(data) {
      res.json(data);
    });
    mediator.publish('workorders:load');
  });
  router.route('/:id').get(function(req, res) {
    var workorderId = req.params.id;
    mediator.once('done:workorder:load:' + workorderId, function(data) {
      res.json(data);
    });
    mediator.publish('workorder:load', workorderId);
  });
  router.route('/:id').put(function(req, res) {
    var workorderId = req.params.id;
    var workorder = req.body;
    // console.log('req.body', req.body);
    mediator.once('done:workorder:save:' + workorderId, function(savedWorkorder) {
      res.json(savedWorkorder);
    });
    mediator.publish('workorder:save', workorder);
  });
  router.route('/').post(function(req, res) {
    var ts = new Date().getTime();  // TODO: replace this with a proper uniqe (eg. a cuid)
    var workorder = req.body;
    workorder.createdTs = ts;
    mediator.once('done:workorder:create:' + ts, function(createdWorkorder) {
      res.json(createdWorkorder);
    });
    mediator.publish('workorder:create', workorder);
  });

  return router;
}

module.exports = function(mediator, app) {
  var router = initRouter(mediator);
  app.use(config.apiPath, router);
};
