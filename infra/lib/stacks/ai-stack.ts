import { Duration, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";

export interface AiStackProps extends StackProps {
  envName: string;
  table: Table;
  uploadsBucket: Bucket;
  artifactsBucket: Bucket;
}

export class AiStack extends Stack {
  public readonly textractQueue: Queue;
  public readonly matchQueue: Queue;
  public readonly reportQueue: Queue;
  public readonly excelExtractor: NodejsFunction;
  public readonly pdfExtractor: NodejsFunction;

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

    this.excelExtractor = new NodejsFunction(this, "ExcelExtractor", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "extract", "excel.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(1),
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
      },
    });

    this.pdfExtractor = new NodejsFunction(this, "PdfExtractor", {
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
      },
    });

    props.table.grantReadWriteData(this.excelExtractor);
    props.table.grantReadWriteData(this.pdfExtractor);
    props.uploadsBucket.grantRead(this.excelExtractor);
    props.uploadsBucket.grantRead(this.pdfExtractor);
    props.artifactsBucket.grantReadWrite(this.excelExtractor);
    props.artifactsBucket.grantReadWrite(this.pdfExtractor);
    this.textractQueue.grantSendMessages(this.pdfExtractor);

    const matchEngine = new NodejsFunction(this, "MatchEngine", {
      entry: path.join(__dirname, "..", "..", "..", "services", "src", "handlers", "match", "engine.ts"),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(5),
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
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
      memorySize: 1536,
      tracing: Tracing.ACTIVE,
      environment: {
        TABLE_NAME: props.table.tableName,
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
      },
    });

    reportGenerator.addEventSource(new SqsEventSource(this.reportQueue));
    props.table.grantReadData(reportGenerator);
    props.artifactsBucket.grantReadWrite(reportGenerator);

    new CfnOutput(this, "TextractQueueUrl", { value: this.textractQueue.queueUrl });
    new CfnOutput(this, "MatchQueueUrl", { value: this.matchQueue.queueUrl });
    new CfnOutput(this, "ReportQueueUrl", { value: this.reportQueue.queueUrl });
  }
}
