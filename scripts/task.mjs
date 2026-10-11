import {PREFIX} from './runtime.mjs';

export function assertManualSendContent(content) {
  if (JSON.stringify(content).includes('请勿发布')) throw new Error('Test content stays protected; no real send handoff');
}

export function parseDynamicOptions(argv, platforms = ["x", "weibo", "xiaohongshu"], entry = "dynamic.mjs") {
  const [command, ...args] = argv;
  if (!["check", "prepare", "inspect", "handoff"].includes(command)) throw new Error(`Usage: ${entry} check|prepare|inspect|handoff --package FILE --platform ${platforms[0]}`);
  const options = { command };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (["--resume-control", "--confirm-manual-send", "--defer-handoff"].includes(key)) {
      if (options[key.slice(2)] !== undefined) throw new Error('Duplicate flag: '+key);
      options[key.slice(2)] = true;
      continue;
    }
    if (!["--package", "--platform", "--profile", "--job-id", "--state-root"].includes(key) || options[key.slice(2)] !== undefined) throw new Error(`Unsupported or duplicate option: ${key}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    options[key.slice(2)] = value;
  }
  if (!options.package || !platforms.includes(options.platform)) throw new Error("Explicit --package and a supported platform required");
  if (options["job-id"] && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(options["job-id"])) throw new Error("Invalid job-id");
  if (["inspect", "handoff"].includes(command) && !options["job-id"]) throw new Error("Existing job-id required");
  if (command === "handoff" && !options["confirm-manual-send"]) throw new Error("User must explicitly request manual send before --confirm-manual-send");
  if (options["confirm-manual-send"] && command !== "handoff") throw new Error("Manual send flag only valid for handoff");
  if(options['defer-handoff']&&command!=='handoff')throw new Error('Deferred handoff only valid for handoff');
  if (options["resume-control"] && (!options["job-id"] || command === "handoff" || command === "check")) throw new Error("Explicit resume requires an existing preparation or inspection job");
  return options;
}

export function existingSpaceScript(state, resumeControl = false) {
  return `
const state = ${JSON.stringify(state)};
const match = (await listTaskSpaces()).find(s => Number(s.id ?? s.spaceId) === state.taskSpaceId && s.name === state.taskSpaceName);
if (!match || (state.profile && match.profileName !== state.profile)) throw new Error("Original space identity or Profile changed; refusing recreation");
const userControl = ["user", "agentDelegatedToUser"].includes(match.ownership);
if (userControl && !${JSON.stringify(resumeControl)}) throw new Error("USER_CONTROL: wait for explicit user resume");
const task = userControl ? await takeOverTaskSpace(state.taskSpaceId) : await taskSpace(state.taskSpaceId);
if (task.spaceId !== state.taskSpaceId || task.name !== state.taskSpaceName) throw new Error("Original space changed");
const tabs = await task.tabs(), pageLabel=state.pageLabel||'p1';
if (tabs.filter(tab=>tab.label===pageLabel).length!==1) throw new Error("Original composer tab changed or ambiguous");
const page = task.page(pageLabel);
const expected = { ...state.pkg, assets: state.assets, fingerprint: state.fingerprint, account: state.account, draftId: state.draftId };
`;
}
export function resultFrom(output) {
  const lines = output.split("\n").filter(line => line.startsWith(PREFIX));
  if (lines.length !== 1) throw new Error("Ego result missing or ambiguous");
  return JSON.parse(lines[0].slice(PREFIX.length));
}
