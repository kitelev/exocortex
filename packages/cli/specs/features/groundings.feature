Feature: Starter-kit grounding execution (RFC 94e520da § Phase 6)
  As an Exocortex CLI user
  I want every starter-kit grounding to behave deterministically when invoked via dyncommand exec
  So that any regression breaking a grounding is caught by the test-bdd CI gate

  All 48 starter-kit groundings (T1.5 audit) are exercised. Per-grounding
  expected outcomes live in packages/cli/specs/fixtures/groundings/<uid>.expected.json.

  Background:
    Given the starter-kit fixture vault is initialized

  Scenario Outline: Grounding "<label>" (<uid>)
    Given a fresh test target asset in the fixture vault
    When I exec grounding "<uid>" via the CLI grounding executor
    Then the result should match the expected fixture for "<uid>"

    Examples:
      | uid | type | cliStatus | label |
      | 58714ab2-c155-47d8-a8bb-38da317817ad | property_delete | real         | Remove start timestamp |
      | 30b9e8d8-bc55-492d-80fa-82f01ed19a45 | service_call    | real         | Link to parent |
      | 4919afb1-fcc3-4a6e-85a0-a869e6a69774 | service_call    | real         | Create related task via service |
      | 4d8d5055-cf83-4d12-8749-7c0f6956d9be | service_call    | unregistered | Create task for daily note via service |
      | 8748f8b0-989b-45a0-88a9-155bc5126f3c | service_call    | real         | Create project |
      | 95aaab51-8cd5-42db-a207-42793864d133 | service_call    | stub         | Create knowledge |
      | a222094b-f499-4342-aec0-65c4ba99c657 | service_call    | stub         | Create task |
      | abdbdf09-8712-4c11-8cbe-467f46091294 | service_call    | real         | Convert to task |
      | c84e2e08-8fb9-42e7-9112-11864fb13a09 | service_call    | stub         | Create note |
      | e72a5fa1-a902-4508-b671-bde8a1461a02 | create_instance | real         | Create Area via service |
      | e8c1d18a-f622-41b4-89e7-9a3be33a96d7 | service_call    | real         | Convert to project |
      | 023596ba-3ea1-4d3c-aaf5-5589c8a4f7f5 | property_set    | real         | Set zone to Today |
      | 6d78a3a4-401a-4fb9-8b44-48c6530eef62 | property_set    | real         | Set zone to This Week |
      | dc39bd9e-77b8-4ecf-b38f-f35795540dd9 | property_set    | real         | Set zone to Someday |
      | bf4772d7-9f5c-401e-9ac6-8f9e240a5928 | service_call    | real         | Rename to UID via service |
      | cd98b4de-3c04-4d05-9715-7335ffb61630 | service_call    | real         | Fix missing label via service |
      | de7914fb-3f56-4278-81f1-6c23345553f0 | service_call    | real         | Clean properties via service |
      | e7189a73-fa97-45ad-b9e9-bd68a0feee10 | service_call    | real         | Repair folder via service |
      | eb3bb751-596b-48f8-b834-7a9e680dabbe | service_call    | real         | Archive asset via service |
      | eba11892-6e8d-4e38-b5e4-d50dd006e6d8 | service_call    | unregistered | Rollback status via service |
      | 1a14832c-f657-4816-b2aa-d06f2a80fccf | property_delete | real         | Delete start timestamp |
      | 2c53ea68-8247-4ea8-870e-3bfbf2256b2f | property_delete | real         | Delete end timestamp |
      | a85668fa-17b7-45d0-aa7f-935e2502dff0 | service_call    | unregistered | Copy label to aliases via service |
      | c4616dcd-3832-4812-b289-0968510fb8be | service_call    | real         | Set result value |
      | 0b104d75-3ed5-44c5-ab04-cffb26e2578a | service_call    | unregistered | Shift day forward via service |
      | 22a6ba6b-030a-47e4-946e-1a30dc9450e5 | service_call    | unregistered | Plan on today via service |
      | 4ffd02e9-f0a6-477d-846e-6364b8b4d528 | property_delete | real         | Remove scheduled date |
      | 506f031e-007f-4c74-8257-158550c64956 | service_call    | unregistered | Increment votes via service |
      | 6ee56341-966c-4791-8eb3-7a75104b2e5b | service_call    | unregistered | Shift day backward via service |
      | 85687461-c2df-4d1b-819b-0c3ae0ab3741 | service_call    | real         | Set planned start timestamp |
      | afda78d9-88e1-4590-8ce8-2c664d6359d3 | service_call    | real         | Set planned end timestamp |
      | d222ddaf-0a56-4bac-91e3-6af02fafebc8 | service_call    | real         | Set scheduled date |
      | f8893042-77ed-4241-959e-e360a4858759 | service_call    | real         | Plan for evening via service |
      | 21e534ee-afe7-464f-8d96-6142660e965b | property_set    | real         | Set status to Draft |
      | 23727560-5f6b-4c49-9b33-eea34c7eec9e | composite       | real         | Transition to Doing (status + startTimestamp) |
      | 53c228c8-c169-4345-a893-9c4dd005949c | property_set    | real         | Set status to Review |
      | 54bd588f-e5f2-4fbf-b6da-64b54a9a3ee4 | property_set    | real         | Set status to ToDo |
      | 584f7e07-d485-4d85-9be6-23b2bf3f19af | property_set    | real         | Set ems__Effort_endTimestamp to $nowLocal |
      | 735a7c95-a5ea-4870-97e5-bb13bc167fc1 | property_set    | real         | Set status to Waiting |
      | 73ec8312-4675-41d9-9fa1-33455d983880 | property_set    | real         | Set ems__Effort_resolutionTimestamp to $nowLocal |
      | 95dfbcad-daca-47aa-8788-74e09f6b10a1 | property_set    | real         | Set ems__Effort_startTimestamp to $nowLocal |
      | bdf3c81f-3531-48a8-a680-eaf5543ea042 | property_set    | real         | Set status to Done |
      | cce66b76-9ca5-4954-85b0-6d549855ed2a | property_set    | real         | Set status to Analysis |
      | cfd2d68a-49cc-4a9f-9231-abd3dece59fb | property_set    | real         | Set status to Backlog |
      | d5deac7a-149d-43a1-b249-875d91834b60 | property_set    | real         | Set status to Doing |
      | ef1d12dc-6a65-4f1d-b7f5-d5c5367d9633 | property_set    | real         | Set status to Blocked |
      | f32de9a1-f62b-4406-8610-31af5003ba29 | property_set    | real         | Set status to Cancelled |
      | f9e23c9e-174b-456c-a2f0-c11f811a7ee6 | composite       | real         | Transition to Done (status + end + resolution) |

  # Task 4.3 (onto-RFC 74c5e336 §Phase 4) — verifies the create_instance
  # behaviour change: copy-from-target frontmatter inheritance + configurable
  # back-link via exocmd__Grounding_linkBackProperty, with the legacy
  # exo__Asset_source back-link suppressed when linkBackProperty is set.
  Scenario: create_instance grounding copies fields from $target and writes configurable back-link
    Given a Grounding with type "create_instance"
    And targetClass "ems__Task"
    And linkBackProperty "ems__Effort_prevIteration"
    And a $target "ems__Task" with frontmatter "exo__Asset_prototype: [[X]]"
    When I execute the grounding
    Then a new "ems__Task" is created
    And the created asset has "exo__Asset_prototype: [[X]]"
    And the created asset has "ems__Effort_prevIteration" pointing to $target
    And the created asset does NOT have "exo__Asset_source"
