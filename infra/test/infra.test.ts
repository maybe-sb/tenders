import { App } from "aws-cdk-lib";
import { DataStack } from "../lib/stacks/data-stack";

 test("data stack synthesizes", () => {
  const app = new App();
  const stack = new DataStack(app, "TestData", { envName: "test" });
  expect(stack).toBeDefined();
});
