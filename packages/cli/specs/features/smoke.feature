Feature: CLI BDD framework smoke
  As a CLI developer
  I want a working Cucumber.js test harness in @kitelev/exocortex-cli
  So that Phase 6 (T6.2) can author 48 starter-kit grounding scenarios on top of it

  Background:
    Given the CLI BDD harness is initialized

  Scenario: Harness boots and shares state across steps
    When I record the value "phase-6-foundation"
    Then the recorded value should be "phase-6-foundation"

  Scenario: Harness runs a deterministic CLI-style command
    When I exec the CLI helper "echo" with payload "hello-bdd"
    Then the helper exit code should be 0
    And the helper stdout should be "hello-bdd"
