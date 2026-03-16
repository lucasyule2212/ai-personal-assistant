export type TestPhase = 'GIVEN' | 'WHEN' | 'THEN';

export const logTestStep = (
  phase: TestPhase,
  label: string,
  value: unknown,
) => {
  console.log(`\n[${phase}] ${label}`);
  console.dir(value, {
    depth: null,
    colors: false,
  });
};
