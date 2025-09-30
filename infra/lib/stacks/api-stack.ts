import { Duration, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Cors, LambdaRestApi } from "aws-cdk-lib/aws-apigateway";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Queue } from "aws-cdk-lib/aws-sqs";
import * as path from "path";

export interface ApiStackProps extends StackProps {
  envName: string;
  table: Table;
  uploadsBucket: Bucket;
  artifactsBucket: Bucket;
  matchQueue: Queue;
  reportQueue: Queue;
  textractQueue: Queue;
}

export class ApiStack extends Stack {
  public readonly api: LambdaRestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const apiHandler = new NodejsFunction(this, "ApiHandler", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "api", "index.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.seconds(30),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        MATCH_QUEUE_URL: props.matchQueue.queueUrl,
        REPORT_QUEUE_URL: props.reportQueue.queueUrl,
        TEXTRACT_QUEUE_URL: props.textractQueue.queueUrl,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5",
        OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER || "priority",
      },
    });

    props.table.grantReadWriteData(apiHandler);
    props.uploadsBucket.grantReadWrite(apiHandler);
    props.artifactsBucket.grantReadWrite(apiHandler);
    props.matchQueue.grantSendMessages(apiHandler);
    props.reportQueue.grantSendMessages(apiHandler);
    props.textractQueue.grantSendMessages(apiHandler);

    this.api = new LambdaRestApi(this, "TendersApi", {
      restApiName: `tenders-${props.envName}`,
      handler: apiHandler,
      proxy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["*"],
      },
      deployOptions: {
        stageName: props.envName,
        metricsEnabled: true,
        tracingEnabled: true,
      },
    });

    new CfnOutput(this, "ApiUrl", { value: this.api.url ?? "" });
  }
}
