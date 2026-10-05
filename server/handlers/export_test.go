package handlers

var BucketHash = bucketHash

func SetSubscriptionUpdater(f func(string, ...string) (string, error)) { updateSubscriptionStatus = f }

func SetAfterSubscribe(f func()) { afterSubscribe = f }
