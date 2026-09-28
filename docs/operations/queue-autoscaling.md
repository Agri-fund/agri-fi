# Queue-Depth Autoscaling

The backend HPA keeps CPU utilization at 80% and adds the `queue_depth` Object metric. Prometheus Adapter maps `rabbitmq_queue_messages{queue="escrow.process"}` to that metric.

- Scale-out threshold: 500 pending escrow messages per active backend deployment.
- CPU threshold: 80% average utilization.
- Minimum replicas: 2.
- Maximum replicas: 10.

Install or upgrade Prometheus Adapter with `devops/k8s/prometheus-adapter-values.yaml`, then confirm the adapter serves the metric before applying the HPA:

```sh
kubectl get --raw '/apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/agri-fi-backend-blue/queue_depth'
kubectl describe hpa agri-fi-backend
```

Sandbox verification:

1. Record the HPA, deployment replica count, and queue depth.
2. Publish a controlled batch above 500 messages to `escrow.process`.
3. Confirm `queue_depth` is visible and the HPA increases replicas within two polling intervals.
4. Drain the queue and confirm scale-down does not go below two replicas.
5. Repeat with CPU load below the queue threshold to verify queue depth alone triggers scale-out.

Run this test in sandbox only, with a bounded message batch and cleanup of all test messages. The HPA targets the active blue slot; update the target reference as part of the blue-green service flip if the deployment naming convention changes.
