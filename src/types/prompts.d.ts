/**
 * Type declarations for prompts module
 * This file provides TypeScript support for the prompts library
 */

declare module 'prompts' {
  interface PromptObject {
    type?: string | ((prev: any, values: any) => string | null);
    name?: string | ((prev: any, values: any) => string);
    message?: string | ((prev: any, values: any) => string);
    initial?: any;
    format?: (value: any) => any;
    validate?: (value: any) => boolean | string;
    onState?: (state: any) => void;
    onRender?: (kleur: any) => void;
    [key: string]: any;
  }

  interface PromptOptions {
    onSubmit?: (prompt: PromptObject, answer: any, answers: any) => void;
    onCancel?: (prompt: PromptObject) => void;
  }

  function prompts(
    questions: PromptObject | PromptObject[],
    options?: PromptOptions
  ): Promise<Record<string, any>>;

  export default prompts;
}
