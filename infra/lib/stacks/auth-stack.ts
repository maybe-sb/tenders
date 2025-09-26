import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  AccountRecovery,
  CfnIdentityPool,
  CfnIdentityPoolRoleAttachment,
  Mfa,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClient,
  UserPoolIdentityProviderAmazon,
} from "aws-cdk-lib/aws-cognito";
import { Role, FederatedPrincipal, ManagedPolicy } from "aws-cdk-lib/aws-iam";

export interface AuthStackProps extends StackProps {
  envName: string;
}

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly identityPool: CfnIdentityPool;
  public readonly authenticatedRole: Role;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, "UserPool", {
      userPoolName: `tenders-${props.envName}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      mfa: Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "tenders-web",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });

    const identityPool = new CfnIdentityPool(this, "IdentityPool", {
      identityPoolName: `tenders-${props.envName}-identity`,
      allowClassicFlow: true,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    const authenticatedRole = new Role(this, "AuthenticatedRole", {
      roleName: `tenders-${props.envName}-authenticated`,
      assumedBy: new FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          "StringEquals": {
            "cognito-identity.amazonaws.com:aud": identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess")],
    });

    new CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    this.identityPool = identityPool;
    this.authenticatedRole = authenticatedRole;

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, "IdentityPoolId", { value: identityPool.ref });
  }
}
