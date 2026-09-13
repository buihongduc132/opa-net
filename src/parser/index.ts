export { CommandParserCoordinator } from './CommandParser.ts';
export { RegexFallbackParser } from './RegexFallbackParser.ts';
export { ShellQuoteParser } from './ShellQuoteParser.ts';
export { stripGitGlobalOptions } from './stripGitGlobalOptions.ts';
export { classifyCheckoutTarget } from './checkoutTarget.ts';
export type { CheckoutClassification } from './checkoutTarget.ts';
export { programBasename, unwrapShellDashC } from './unwrapShellDashC.ts';
export { unwrapWrapperTokens } from './unwrapWrapperProgram.ts';
export type { CommandParser, ParseConfidence, ParsedCommand } from './types.ts';
