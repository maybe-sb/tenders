import { Duration, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Tracing, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";

export interface AiStackProps extends StackProps {
  envName: string;
  table: Table;
  uploadsBucket: Bucket;
  artifactsBucket: Bucket;
  excelQueue: Queue;
  pdfQueue: Queue;
}

export class AiStack extends Stack {
  public readonly textractQueue: Queue;
  public readonly matchQueue: Queue;
  public readonly reportQueue: Queue;
  public readonly insightsQueue: Queue;

  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    this.textractQueue = new Queue(this, "TextractQueue", {
      queueName: `tenders-textract-${props.envName}`,
      visibilityTimeout: Duration.minutes(15),
    });

    this.matchQueue = new Queue(this, "MatchQueue", {
      queueName: `tenders-match-${props.envName}`,
      visibilityTimeout: Duration.minutes(5),
    });

    this.reportQueue = new Queue(this, "ReportQueue", {
      queueName: `tenders-report-${props.envName}`,
      visibilityTimeout: Duration.minutes(15),
    });

    this.insightsQueue = new Queue(this, "InsightsQueue", {
      queueName: `tenders-insights-${props.envName}`,
      visibilityTimeout: Duration.minutes(5),
    });

    // AI-Enhanced Excel Extractor (replacing the traditional one)
    const excelExtractor = new NodejsFunction(this, "ExcelExtractor", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "extract", "excel-ai.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(15),
      memorySize: 2048,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        // IMPORTANT: Set these environment variables in AWS Lambda console or CDK context
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5",
        OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER || "priority",
      },
    });

    excelExtractor.addEventSource(new SqsEventSource(props.excelQueue));

    const pdfExtractor = new NodejsFunction(this, "PdfExtractor", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "extract", "pdf.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(5),
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        TEXTRACT_QUEUE_URL: this.textractQueue.queueUrl,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5",
        OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER ?? "priority",
      },
    });

    pdfExtractor.addEventSource(new SqsEventSource(props.pdfQueue));

    props.table.grantReadWriteData(excelExtractor);
    props.table.grantReadWriteData(pdfExtractor);
    props.uploadsBucket.grantRead(excelExtractor);
    props.uploadsBucket.grantRead(pdfExtractor);
    props.artifactsBucket.grantReadWrite(excelExtractor);
    props.artifactsBucket.grantReadWrite(pdfExtractor);
    this.textractQueue.grantSendMessages(pdfExtractor);

    const matchEngine = new NodejsFunction(this, "MatchEngine", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "match", "engine.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(5),
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
      },
    });

    matchEngine.addEventSource(new SqsEventSource(this.matchQueue));
    props.table.grantReadWriteData(matchEngine);
    props.artifactsBucket.grantReadWrite(matchEngine);

    const reportGenerator = new NodejsFunction(this, "ReportGenerator", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "reports", "generate.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(10),
      memorySize: 2048,
      tracing: Tracing.ACTIVE,
      depsLockFilePath: path.join(__dirname, "..", "..", "..", "services", "package-lock.json"),
      bundling: {
        nodeModules: ["@sparticuz/chromium"],
      },
      environment: {
        TABLE_NAME: props.table.tableName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5",
        OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER ?? "priority",
      },
    });

    reportGenerator.addEventSource(new SqsEventSource(this.reportQueue));
    props.table.grantReadWriteData(reportGenerator);
    props.artifactsBucket.grantReadWrite(reportGenerator);

    const insightsGenerator = new NodejsFunction(this, "InsightsGenerator", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "insights", "generate.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(5),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5",
        OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER || "priority",
      },
    });

    insightsGenerator.addEventSource(new SqsEventSource(this.insightsQueue));
    props.table.grantReadWriteData(insightsGenerator);

    new CfnOutput(this, "TextractQueueUrl", { value: this.textractQueue.queueUrl });
    new CfnOutput(this, "MatchQueueUrl", { value: this.matchQueue.queueUrl });
    new CfnOutput(this, "ReportQueueUrl", { value: this.reportQueue.queueUrl });
    new CfnOutput(this, "InsightsQueueUrl", { value: this.insightsQueue.queueUrl });
  }
}
