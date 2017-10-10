# Usage

## config.json

Create a file named `config.json` in this directory with a structure like this:

```json
{
  "team": "avengers",
  "days": 90,
  "key": "XXX",
  "secret": "XXX",
  "instance": "app.scaleft.com"
}
```

The value for `team` should be your team name. 

The value for `days` is a count of days prior to the present moment to build the report from.

The values for `key` and `secret` are the key ID and secret from a ScaleFT service user which is in at least one group granting the Reporting and Admin permissions.

The `instance` field is optional and will default to `app.scaleft.com`. This field is intended to be the name of the ScaleFT instance to query.

## Execution

The command `./build-access-report.js` will print tab-delimited records of credentials being issued for access grouped by project and sorted by date. This uses a paginated API and may make a number of API requests. It will exit 1 on error.

# Troubleshooting

Setting the `DEBUG` environment variable will cause logs to be printed to the console: `DEBUG=1 ./build-access-report.js`
