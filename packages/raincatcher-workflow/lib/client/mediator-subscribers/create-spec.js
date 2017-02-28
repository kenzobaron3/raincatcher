var mediator = require("fh-wfm-mediator/lib/mediator");
var chai = require('chai');
var _ = require('lodash');
var CONSTANTS = require('../../constants');

var expect = chai.expect;

var MediatorTopicUtility = require('fh-wfm-mediator/lib/topics');

describe("Workflow Create Mediator Topic", function() {

  var mockWorkflowToCreate = {
    name: "This is a mock Work Order"
  };

  var expectedCreatedWorkflow =  _.extend({_localuid: "createdWorkflowLocalId"}, mockWorkflowToCreate);

  var topicUid = 'testtopicuid1';

  var createTopic = "wfm:workflows:create";
  var doneCreateTopic = "done:wfm:workflows:create:testtopicuid1";
  var errorCreateTopic = "error:wfm:workflows:create:testtopicuid1";

  var syncCreateTopic = "wfm:sync:workflows:create";
  var doneSyncCreateTopic = "done:wfm:sync:workflows:create";
  var errorSyncCreateTopic = "error:wfm:sync:workflows:create";

  var workflowSubscribers = new MediatorTopicUtility(mediator);
  workflowSubscribers.prefix(CONSTANTS.TOPIC_PREFIX).entity(CONSTANTS.WORKFLOW_ENTITY_NAME);

  beforeEach(function() {
    this.subscribers = {};
    workflowSubscribers.on(CONSTANTS.TOPICS.CREATE, require('./create')(workflowSubscribers));
  });

  afterEach(function() {
    _.each(this.subscribers, function(subscriber, topic) {
      mediator.remove(topic, subscriber.id);
    });

    workflowSubscribers.unsubscribeAll();
  });

  it('should use the sync topics to create a workflow', function() {
    this.subscribers[syncCreateTopic] = mediator.subscribe(syncCreateTopic, function(parameters) {
      expect(parameters.itemToCreate).to.deep.equal(mockWorkflowToCreate);
      expect(parameters.topicUid).to.be.a('string');

      mediator.publish(doneSyncCreateTopic + ":" + parameters.topicUid, expectedCreatedWorkflow);
    });

    var donePromise = mediator.promise(doneCreateTopic);

    mediator.publish(createTopic, {
      workflowToCreate: mockWorkflowToCreate,
      topicUid: topicUid
    });

    return donePromise.then(function(createdWorkflow) {
      expect(createdWorkflow).to.deep.equal(expectedCreatedWorkflow);
    });
  });

  it('should publish an error if there is no object to update', function() {
    var errorPromise = mediator.promise(errorCreateTopic);

    mediator.publish(createTopic, {
      topicUid: topicUid
    });

    return errorPromise.then(function(error) {
      expect(error.message).to.have.string("Invalid Data");
    });
  });

  it('should handle an error from the sync create topic', function() {
    var expectedError = new Error("Error performing sync operation");
    this.subscribers[syncCreateTopic] = mediator.subscribe(syncCreateTopic, function(parameters) {
      expect(parameters.itemToCreate).to.deep.equal(mockWorkflowToCreate);
      expect(parameters.topicUid).to.be.a('string');

      mediator.publish(errorSyncCreateTopic + ":" + parameters.topicUid, expectedError);
    });

    var errorPromise = mediator.promise(errorCreateTopic);

    mediator.publish(createTopic, {
      workflowToCreate: mockWorkflowToCreate,
      topicUid: topicUid
    });

    return errorPromise.then(function(error) {
      expect(error).to.deep.equal(expectedError);
    });
  });
});