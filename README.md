# RunCoach

An MCP server that exposes a runner's own training data — computed training
load, race-time predictions, generated plans — as tools an LLM can call.

The point is grounding. Ask any assistant "should I back off this week" and it
will produce plausible coaching advice from nothing. RunCoach makes the same
question resolve against the athlete's actual recorded activities, with the
answer carrying the specific runs it came from:

> **You:** How's my training going, and what could I run a half in?
>
> **Claude** *(calls `analyze_training_status`, then `predict_race_time`)*:
> Training is consistent and load is steady — 46.8 km/week across 17 runs in the
> last 28 days, with an acute-to-chronic ratio of 1.00 and no gap longer than
> three days. Fitness is being maintained rather than built, which is the right
> place to be between goals and worth changing if you have a race coming.
>
> For the half: **1:38:49**, most likely between 1:36:50 and 1:40:48. That's
> fitted to your own distance/time curve across your 5K (21:30, 8 July), 10K
> (44:50, 3 June) and half (1:38:48, 29 April) — your fatigue exponent came out
> at 1.059 against a population average of 1.06, so you hold pace about as well
> as typical as distance grows. One activity was excluded: a 3 km on 28 July
> recorded at a pace faster than the world record for that distance, almost
> certainly a GPS error.

Every figure above is real output from `npm test`'s fixture athlete, not an
illustration — the exact strings appear in
[`test/readme.test.ts`](test/readme.test.ts), which fails if the science moves and the README is not updated with it. Every tool returns a
confidence and an explanation of how its number was derived, and the server's
instructions tell the model to carry both through. A prediction stated without
its basis is indistinguishable from a guess.

## Tools

| Tool | Answers |
|---|---|
| `analyze_training_status` | "How is my training going?" — composite readiness read from load trend, consistency and volume, with explicit caveats |
| `get_training_load` | Fitness (CTL), fatigue (ATL), form (TSB) and acute:chronic ratio over a window |
| `predict_race_time` | "What could I run for X?" — with the reference efforts used and the implausible ones excluded |
| `get_recent_activities` | Recent runs with pace, HR and per-activity computed load |
| `generate_training_plan` | A periodised plan from measured volume, or a refusal explaining why one would be unsafe |

## Where the numbers come from

RunCoach reimplements nothing. Every calculation is
[`@runman/core`](https://github.com/varun-gangadharan/runman), the fixture-tested
science package that also backs the [Runman](https://github.com/varun-gangadharan/runman)
web app. Asking Claude a question and loading the corresponding page run the same
code against the same database.

That package is vendored here as a git submodule, and RunCoach's tests import
**the same fixture file** Runman's tests use — so "what should this data produce"
has one definition across both repos rather than two that drift.

```bash
git clone --recursive https://github.com/varun-gangadharan/runcoach
npm install
npm test          # 31 tests, no database or credentials required
```

## Design decisions worth explaining

**Tools do not take an athlete id.** The API key resolves to exactly one
athlete, and that id becomes the tool context. If a model could pass an athlete
id, a prompt-injected instruction in an activity title could ask it to — and the
payload here is somebody's personal health data. There is simply no argument by
which one athlete's key can read another's data. A test asserts this stays true.

**A refusal is a valid answer.** When there is no data to support a prediction,
the tool says so *and* instructs the model not to substitute an estimate. Same
for plan generation: if the athlete has no recent training, or the race is three
weeks away, it refuses with a reason rather than producing a plan built on a
guessed baseline. Models fill gaps by default; the tool output has to actively
push back.

**Output is prose, not JSON.** Models paraphrase sentences more faithfully than
they read nested objects, and are far less likely to invent a field that was not
there. Precise figures still appear — inside sentences.

**Each HTTP request builds its own server instance.** Sharing one across
invocations in a serverless environment risks interleaving two athletes'
sessions inside a warm container. That is not an acceptable failure mode here.

## Deployment

The HTTP transport is a single Vercel function. Authentication is a bearer token
— an API key the athlete issues from the Runman profile page, stored only as a
SHA-256 hash.

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel deploy --prod
```

Then add it in any MCP client:

```json
{
  "mcpServers": {
    "runcoach": {
      "type": "http",
      "url": "https://<your-deployment>/mcp",
      "headers": { "Authorization": "Bearer rc_live_..." }
    }
  }
}
```

### Running locally over stdio

For use against your own data on your own machine:

```json
{
  "mcpServers": {
    "runcoach": {
      "command": "node",
      "args": ["/absolute/path/to/runcoach/dist/stdio.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "RUNCOACH_API_KEY": "rc_live_..."
      }
    }
  }
}
```

A stdio server has no requests to authenticate — it runs as a child process of
the client — so the athlete is fixed at startup. That is only appropriate on the
athlete's own machine, which is why the deployed transport does it per request
instead.

## Testing

```bash
npm test
```

31 tests across three layers: the tool handlers against Runman's shared fixture
set (consistent runner, no-heart-rate runner, single activity, empty history,
GPS-glitch history, sporadic runner, returning runner, volume spike), and an
end-to-end protocol test that connects a real MCP client to a real server and
drives it through tool discovery, schema validation and invocation. The third layer pins the example figures quoted in this README.

## Not in v1

Garmin-sourced tools (recovery, sleep, HRV) by proxying into an upstream Garmin
MCP server, gated behind the athlete having linked an account. Deliberately
separable, so an athlete without Garmin sees no degradation.

## Licence

MIT.
