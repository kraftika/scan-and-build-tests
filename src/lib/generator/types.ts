export type TestableActionType = 'navigation' | 'form' | 'interaction' | 'smoke';

export interface TestableAction {
  type: TestableActionType;
  description: string;
  selector: string | null;
  expectedOutcome: string;
}

export type TestSuite = Record<string, string>; // filename → .spec.ts content
