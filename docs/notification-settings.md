# Notification Settings

`notification_settings` configures organization or site email recipients.

v0.1 supports only:

```text
channel = email
```

Access:

- organization owner can read settings
- mutation is controlled server-side
- agent and viewer have no direct table access

Recipient email is normalized/lowercase and validated by DB constraints. It is not copied to audit metadata or delivery attempt rows.

Changing settings should audit:

```text
notification.settings_changed
```
