'use strict';

var express = require('express');
var config = require('../user/config-user');
var userAuth = require('./mbaas-auth');
var sessionMiddleware = require('./mbaas-session-middleware');
var _ = require('lodash');

function initRouter(mediator, authResponseExclusionList, expressSessionMiddleware) {
  var router = express.Router();

  router.all('/auth', function(req, res) {
    var params = req.body;
    var userId = params && params.userId || params.username;

    //If there is no userId, then we cannot authenticate.
    if (!userId) {
      console.log('No username provided');
      res.status(400);
      return res.json({message: 'Invalid credentials'});
    }

    // try to authenticate
    userAuth.auth(mediator, userId, params.password)
      .then(function(profileData) {
        // trim the authentication response to remove specified fields
        var authResponse = trimAuthResponse(profileData, authResponseExclusionList);
        // on success pass relevant data into response

        //Using express-session to generate and store a session.
        //This is only done for authenticated requests. Otherwise we don't generate a session
        //as it would cause a session to be created for every request.
        expressSessionMiddleware(req, res, function(err) {
          //An error occurred while trying to create a valid session token for the user.
          if (err) {
            return res.status(500).json({message: "Unexpected error when creating a session. Please try again."});
          }

          res.status(200).json({
            status: 'ok',
            userId: userId,
            sessionToken: req.sessionID,
            authResponse: authResponse
          });
        });
      })
      .catch(function(err) {
        // on error pass error message into response body, assign 401 http code.
        // 401 - invalid credentials (unauthorised)
        res.status(401);
        res.json(err.message ? err.message : 'Invalid Credentials');
      });
  });

  router.all('/verifysession', sessionMiddleware.verifySession, function(req, res) {
    res.json({
      isValid: req.sessionValid
    });
  });

  router.all('/revokesession', sessionMiddleware.revokeSession, function(req, res) {
    res.json({});
  });

  router.route('/').get(function(req, res) {
    mediator.once('done:wfm:user:list', function(data) {
      res.json(data);
    });
    mediator.publish('wfm:user:list');
  });
  router.route('/:id').get(function(req, res) {
    var userId = req.params.id;
    mediator.once('done:wfm:user:read:' + userId, function(data) {
      res.json(data);
    });
    mediator.publish('wfm:user:read', userId);
  });
  router.route('/:id').put(function(req, res) {
    var userId = req.params.id;
    var user = req.body.user;
    mediator.once('done:wfm:user:update:' + userId, function(saveduser) {
      res.json(saveduser);
    });
    mediator.publish('wfm:user:update', user);
  });
  router.route('/').post(function(req, res) {
    var ts = new Date().getTime();  // TODO: replace this with a proper uniqe (eg. a cuid)
    var user = req.body.user;
    user.createdTs = ts;
    mediator.once('done:wfm:user:create:' + ts, function(createduser) {
      res.json(createduser);
    });
    mediator.publish('wfm:user:create', user, ts);
  });
  router.route('/:id').delete(function(req, res) {
    var userId = req.params.id;
    var user = req.body.user;
    mediator.once('done:wfm:user:delete:' + userId, function(deleted) {
      res.json(deleted);
    });
    mediator.publish('wfm:user:delete', user);
  });
  return router;
}

/**
* Function to trim the authentication response to remove certain fields from being sent.
* By default, the password will be removed from the response.
* @param authResponse {object} - the untrimmed auth response
* @param exclusionList {array} - the array of field names to remove from the authentication response
* @return authResponse {object} - the trimmed authentication response
*/
function trimAuthResponse(authResponse, exclusionList) {
  if (exclusionList === undefined || exclusionList === null) {
    // return a default auth response if the exclusion list is null or undefined
    return _.omit(authResponse, config.defaultAuthResponseExclusionList);
  }
  return _.omit(authResponse, exclusionList);
}

/**
 * Initializes the router, mounting it in the supplied express application
 * @param  {Mediator}   mediator                 Mediator instance from fh-wfm-mediator
 * @param  {Express.App}   app                   Express application
 * @param  {Array}   authResponseExclusionList   List of fields in the User schema to exclude from responses
 * @param  {Object}   sessionOptions             Options for storage and express-session
 * @param  {Function} cb                         Node-style callback
 */
function init(mediator, app, authResponseExclusionList, sessionOptions, cb) {

  sessionMiddleware.init(sessionOptions, function(err, result) {
    if (err) {
      return cb(err);
    }

    //Creating the express-session middleware using the redis or mongo database.
    var expressSessionMiddleware = result.session({
      secret: result.options.config.secret,
      store: result.store,
      resave: result.options.config.resave,
      saveUninitialized: result.options.config.saveUninitialized
    });


    //The express session is only used for authentication responses
    var router = initRouter(mediator, authResponseExclusionList, expressSessionMiddleware);
    app.use(config.apiPath, router);
    return cb();
  });
}

module.exports = {
  init: init,
  trimAuthResponse: trimAuthResponse
};
