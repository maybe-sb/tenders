import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export const sqsClient = new SQSClient({});

export async function sendQueueMessage(queueUrl: string, payload: unknown): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload ?? {}),
    })
  );
}
