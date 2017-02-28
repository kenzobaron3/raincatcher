var angular = require('angular');

/**
 * Script to subscribe to the `wfm:auth:profile:change` topic.
 *
 * This will check to see if a user is logging in or out.
 *
 * @param $state
 * @param mediator
 * @param syncPool
 * @constructor
 */
function subscribeToUserChange($state, mediator, syncPool) {
  mediator.subscribe('wfm:auth:profile:change', function(_profileData) {
    if (_profileData === null) { // a logout
      syncPool.removeManagers().then(function() {
        $state.go('app.login', undefined, {reload: true});
      }, function(err) {
        console.err(err);
      });
    } else {
      syncPool.syncManagerMap(_profileData)  // created managers will be cached
        .then(syncPool.forceSync)
        .then(function() {
          $state.go('app.schedule', undefined, {reload: true});
        });
    }
  });
}

/**
 *
 * Creating promises for any of the fh-wfm modules that require asynchronous initialisation
 *
 * @param $rootScope
 * @param $q
 * @param mediator
 * @param userClient
 * @constructor
 */
function createWFMInitialisationPromises($rootScope, $q, mediator, userClient) {
  var initPromises = [];
  var initListener = mediator.subscribe('promise:init', function(promise) {
    initPromises.push(promise);
  });

  mediator.publish('init');
  console.log(initPromises.length, 'init promises to resolve.');
  var all = (initPromises.length > 0) ? $q.all(initPromises) : $q.when(null);
  return all.then(function() {
    $rootScope.ready = true;
    console.log(initPromises.length, 'init promises resolved.');
    mediator.remove('promise:init', initListener.id);
    userClient.clearSession();

    return null;
  });
}


/**
 *
 * Registering listeners for state changes and errors
 *
 * @param $rootScope
 * @param $state
 * @param userClient
 * @constructor
 */
function verifyLoginOnStateChange($rootScope, $state, userClient) {

  $rootScope.$on('$stateChangeStart', function(e, toState, toParams) {
    //Verifying that the logged in user has a session before showing any other screens but the login.
    if (toState.name !== "app.login") {
      userClient.hasSession().then(function(hasSession) {
        if (!hasSession) {
          e.preventDefault();
          $rootScope.toState = toState;
          $rootScope.toParams = toParams;
          $state.go('app.login');
        }
      });
    }
  });
  $rootScope.$on('$stateChangeError', function(event, toState, toParams, fromState, fromParams, error) {
    console.error('State change error: ', error, {
      event: event,
      toState: toState,
      toParams: toParams,
      fromState: fromState,
      fromParams: fromParams,
      error: error
    });
    if (error['get stack']) {
      console.error(error['get stack']());
    }
    event.preventDefault();
  });
}


angular.module('app').run(["$rootScope", "$q", "mediator", "userClient", createWFMInitialisationPromises])
  .run(["$state", "mediator", "syncPool", subscribeToUserChange])
  .run(["$rootScope", "$state", "userClient", verifyLoginOnStateChange]);