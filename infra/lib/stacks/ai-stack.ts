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
  excelQueue: Queue;
  pdfQueue: Queue;
}

export class AiStack extends Stack {
  public readonly textractQueue: Queue;
  public readonly matchQueue: Queue;
  public readonly reportQueue: Queue;

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

    const excelExtractor = new NodejsFunction(this, "ExcelExtractor", {
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
