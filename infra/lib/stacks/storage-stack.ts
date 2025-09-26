import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket, BucketEncryption, EventType, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsDestination } from "aws-cdk-lib/aws-s3-notifications";

export interface StorageStackProps extends StackProps {
  envName: string;
}

export class StorageStack extends Stack {
  public readonly uploadsBucket: Bucket;
  public readonly artifactsBucket: Bucket;
  public readonly excelQueue: Queue;
  public readonly pdfQueue: Queue;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.excelQueue = new Queue(this, "ExcelUploadQueue", {
      queueName: `tenders-excel-uploads-${props.envName}`,
      visibilityTimeout: Duration.minutes(5),
    });

    this.pdfQueue = new Queue(this, "PdfUploadQueue", {
      queueName: `tenders-pdf-uploads-${props.envName}`,
      visibilityTimeout: Duration.minutes(15),
    });

    this.uploadsBucket = new Bucket(this, "UploadsBucket", {
      bucketName: `tenders-uploads-${props.envName}-${this.account}`.toLowerCase(),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.PUT, HttpMethods.POST],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      versioned: true,
    });

    this.uploadsBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(this.excelQueue),
      { suffix: ".xlsx" }
    );

    this.uploadsBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(this.excelQueue),
      { suffix: ".xls" }
    );

    this.uploadsBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(this.pdfQueue),
      { suffix: ".pdf" }
    );

    this.artifactsBucket = new Bucket(this, "ArtifactsBucket", {
      bucketName: `tenders-artifacts-${props.envName}-${this.account}`.toLowerCase(),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          expiration: Duration.days(365),
        },
      ],
    });

    new CfnOutput(this, "UploadsBucketName", { value: this.uploadsBucket.bucketName });
    new CfnOutput(this, "ArtifactsBucketName", { value: this.artifactsBucket.bucketName });
    new CfnOutput(this, "ExcelQueueUrl", { value: this.excelQueue.queueUrl });
    new CfnOutput(this, "PdfQueueUrl", { value: this.pdfQueue.queueUrl });
  }
}
