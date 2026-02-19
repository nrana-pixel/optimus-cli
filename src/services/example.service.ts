/**
 * Example Service
 * Contains business logic for the CLI application
 */

export class ExampleService {
  /**
   * Greet a user
   * @param name - The name of the user
   * @returns A greeting message
   */
  static greet(name: string): string {
    return `Hello, ${name}!`;
  }

  /**
   * Get application version
   * @returns The version string
   */
  static getVersion(): string {
    return '1.0.0';
  }

  /**
   * Process data
   * @param data - Input data to process
   * @returns Processed data
   */
  static processData(data: string): string {
    return data.toUpperCase();
  }
}
