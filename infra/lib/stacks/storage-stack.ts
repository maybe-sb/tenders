import { RemovalPolicy, Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";

export interface StorageStackProps extends StackProps {
  envName: string;
}

export class StorageStack extends Stack {
  public readonly uploadsBucket: Bucket;
  public readonly artifactsBucket: Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.uploadsBucket = new Bucket(this, "UploadsBucket", {
      bucketName: `tenders-uploads-${props.envName}-${this.account}`.toLowerCase(),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: { blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true },
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.PUT, HttpMethods.POST],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"]
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      versioned: true,
    });

    this.artifactsBucket = new Bucket(this, "ArtifactsBucket", {
      bucketName: `tenders-artifacts-${props.envName}-${this.account}`.toLowerCase(),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: { blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true },
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
  }
}
