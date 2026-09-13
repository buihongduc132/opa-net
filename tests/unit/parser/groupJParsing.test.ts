import { describe, expect, it } from 'bun:test';
import { CommandParserCoordinator } from '../../../src/parser/CommandParser.ts';

/**
 * GROUP J — DevOps CLI shape canary.
 * terraform/tofu/terragrunt/nomad/consul/vault are subcommand-shaped;
 * aws/pm2/systemctl/dd/docker-compose are flat-arg-shaped. If any of these
 * drift in SUBCOMMAND_PROGRAMS, GROUP J rego rules silently stop firing —
 * this test is the canary.
 */
const parser = new CommandParserCoordinator();

const SUBCOMMAND_SHAPED: Array<[string, string, string[]]> = [
  ['terraform destroy', 'destroy', []],
  ['tofu state rm x', 'state', ['rm', 'x']],
  ['terragrunt run destroy', 'run', ['destroy']],
  ['nomad job stop api', 'job', ['stop', 'api']],
  ['consul kv delete foo', 'kv', ['delete', 'foo']],
  ['vault secrets disable pki', 'secrets', ['disable', 'pki']],
];

const FLAT_SHAPED: Array<[string, string, string[]]> = [
  [
    'aws ec2 terminate-instances --instance-ids i-1',
    'aws',
    ['ec2', 'terminate-instances', '--instance-ids', 'i-1'],
  ],
  ['pm2 kill', 'pm2', ['kill']],
  ['systemctl stop nginx', 'systemctl', ['stop', 'nginx']],
  ['dd if=/dev/zero of=/dev/sda', 'dd', ['if=/dev/zero', 'of=/dev/sda']],
  [
    'docker-compose --project-name=litellm down',
    'docker-compose',
    ['--project-name=litellm', 'down'],
  ],
];

describe('GROUP J CLI shape canary', () => {
  for (const [raw, sub, args] of SUBCOMMAND_SHAPED) {
    it(`${raw} → subcommand=${sub}`, () => {
      const r = parser.parse(raw);
      expect(r.subcommand).toBe(sub);
      expect(r.args).toEqual(args);
    });
  }

  for (const [raw, program, args] of FLAT_SHAPED) {
    it(`${raw} → flat (subcommand="")`, () => {
      const r = parser.parse(raw);
      expect(r.program).toBe(program);
      expect(r.subcommand).toBe('');
      expect(r.args).toEqual(args);
    });
  }
});
