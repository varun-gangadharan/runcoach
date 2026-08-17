/**
 * MCP server construction.
 *
 * Transport-agnostic on purpose: the same server object is served over stdio for
 * local use and over streamable HTTP when deployed, so there is one definition
 * of what the tools are and no chance of the two drifting.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  analyzeStatus,
  analyzeTrainingStatusSchema,
  generatePlan,
  generateTrainingPlanSchema,
  getRecentActivities,
  getRecentActivitiesSchema,
  getTrainingLoad,
  getTrainingLoadSchema,
  predictRace,
  predictRaceTimeSchema,
} from './tools/definitions.ts';
import { guard, type ToolContext } from './tools/context.ts';

export const SERVER_INFO = {
  name: 'runcoach',
  version: '1.0.0',
} as const;

/**
 * Tool descriptions are load-bearing. A model decides whether to call a tool
 * from its description alone, so each one says what question it answers rather
 * than what function it wraps — and, where it matters, says what the model must
 * *not* do instead of calling it.
 */
export function createServer(context: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'RunCoach exposes one runner\'s actual training data: computed training load, race-time ' +
      'predictions, and generated plans, all derived from their real recorded activities.\n\n' +
      'Use these tools rather than reasoning about running from general knowledge whenever the ' +
      'question concerns this athlete specifically. Every tool returns a confidence and an ' +
      'explanation of how its number was derived — carry both into your answer. A prediction ' +
      'presented without its basis is indistinguishable from a guess, and the whole point of these ' +
      'tools is that the numbers can be traced back to specific runs.\n\n' +
      'When a tool reports that it lacks the data to answer, say so plainly. Do not substitute an ' +
      'estimate of your own.',
  });

  server.registerTool(
    'get_training_load',
    {
      title: 'Get training load',
      description:
        'Current training load for the athlete, with fitness (CTL), fatigue (ATL), form (TSB) and ' +
        'the acute:chronic workload ratio, plus how each has trended over a chosen window. Use this ' +
        'for questions about whether load is rising or falling, whether the athlete is fresh or ' +
        'fatigued, or whether they are ramping up too fast.',
      inputSchema: getTrainingLoadSchema,
    },
    (args) => guard(() => getTrainingLoad(context, args)),
  );

  server.registerTool(
    'predict_race_time',
    {
      title: 'Predict race time',
      description:
        "Predict the athlete's race time at a standard distance from their actual recorded efforts. " +
        'Returns a time, a plausible range, and the specific activities the prediction was derived ' +
        'from, along with any activities excluded as implausible. Use this for any "what could I run" ' +
        'question — do not estimate race times yourself from weekly mileage or from paces you have ' +
        'seen mentioned in conversation.',
      inputSchema: predictRaceTimeSchema,
    },
    (args) => guard(() => predictRace(context, args)),
  );

  server.registerTool(
    'get_recent_activities',
    {
      title: 'Get recent activities',
      description:
        'The athlete\'s recent runs with distance, time, pace, heart rate where recorded, and the ' +
        'computed training load of each. Use this when the question is about specific sessions, ' +
        'recent consistency, or what the athlete has actually been doing.',
      inputSchema: getRecentActivitiesSchema,
    },
    (args) => guard(() => getRecentActivities(context, args)),
  );

  server.registerTool(
    'generate_training_plan',
    {
      title: 'Generate a training plan',
      description:
        'Build a periodised plan to a target race, starting from the volume the athlete has actually ' +
        'been running over the last 28 days and progressing at no more than 10% a week, with recovery ' +
        'weeks and a taper. Returns week-by-week volume, sessions and target paces derived from their ' +
        'own threshold. If the inputs make a safe plan impossible the tool refuses and explains why — ' +
        'relay the refusal rather than writing a plan yourself.',
      inputSchema: generateTrainingPlanSchema,
    },
    (args) => guard(() => generatePlan(context, args)),
  );

  server.registerTool(
    'analyze_training_status',
    {
      title: 'Analyze training status',
      description:
        'A composite readiness assessment combining load trend, consistency, volume and heart-rate ' +
        'data into a plain-language read on how the athlete is training, with specific ' +
        'recommendations and an explicit list of what limits the assessment. Use this for open ' +
        'questions like "how is my training going" or "am I ready to race".',
      inputSchema: analyzeTrainingStatusSchema,
    },
    (args) => guard(() => analyzeStatus(context, args)),
  );

  return server;
}
