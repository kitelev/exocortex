# language: en
@reading-view @body-link-patch @critical
Feature: Reading View Link Labels

  As an Exocortex plugin user
  I want to see human-readable labels in Reading View wikilinks
  So that I can navigate my knowledge base without seeing raw UUIDs

  Rule: Internal links in Reading View show exo__Asset_label, not UUID or class suffix

    Scenario: ems__Task link shows label only
      Given a note "source" exists with body content linking to asset "fix-bug-uuid"
      And asset "fix-bug-uuid" exists with metadata:
        | Property            | Value            |
        | exo__Asset_label    | Fix the login bug |
        | exo__Instance_class | [[ems__Task]]    |
      When I open "source" in Reading View
      Then the internal link to "fix-bug-uuid" displays text "Fix the login bug"
      And the link does NOT show "Fix the login bug (ems__Task)"
      And the link does NOT show "fix-bug-uuid"

    Scenario: ims__Concept link shows label only (H1 regression)
      Given a note "source" exists with body content linking to asset "concept-uuid"
      And asset "concept-uuid" exists with metadata:
        | Property            | Value           |
        | exo__Asset_label    | Wikilink Pattern |
        | exo__Instance_class | [[ims__Concept]] |
      When I open "source" in Reading View
      Then the internal link to "concept-uuid" displays text "Wikilink Pattern"
      And the link does NOT show "Wikilink Pattern (ims__Concept)"
      And the link does NOT show "concept-uuid"

    Scenario: ems__TaskPrototype link shows label with suffix
      Given a note "source" exists with body content linking to asset "morning-proto-uuid"
      And asset "morning-proto-uuid" exists with metadata:
        | Property            | Value                  |
        | exo__Asset_label    | Morning Standup        |
        | exo__Instance_class | [[ems__TaskPrototype]] |
      When I open "source" in Reading View
      Then the internal link to "morning-proto-uuid" displays text "Morning Standup (TaskPrototype)"

    Scenario: Unknown class link shows label only (no class suffix)
      Given a note "source" exists with body content linking to asset "custom-uuid"
      And asset "custom-uuid" exists with metadata:
        | Property            | Value                   |
        | exo__Asset_label    | My Knowledge Note       |
        | exo__Instance_class | [[ztlk__FleetingNote]]  |
      When I open "source" in Reading View
      Then the internal link to "custom-uuid" displays text "My Knowledge Note"
      And the link does NOT show "My Knowledge Note (ztlk__FleetingNote)"

    Scenario: Link without exo__Asset_label is not patched
      Given a note "source" exists with body content linking to asset "no-label-uuid"
      And asset "no-label-uuid" exists with metadata:
        | Property            | Value         |
        | exo__Instance_class | [[ems__Task]] |
      When I open "source" in Reading View
      Then the internal link to "no-label-uuid" shows the original file basename

    Scenario: User-defined alias is preserved
      Given a note "source" exists with body content:
        """
        See [[concept-uuid|My Custom Alias]] for details.
        """
      And asset "concept-uuid" exists with metadata:
        | Property         | Value            |
        | exo__Asset_label | Wikilink Pattern |
      When I open "source" in Reading View
      Then the internal link displays text "My Custom Alias"
      And NOT "Wikilink Pattern"
