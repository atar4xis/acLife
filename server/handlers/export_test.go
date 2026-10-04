package handlers

var BucketHash = bucketHash

func SetSubStatus(subID, status string) { setSubStatus(subID, status) }

func ClearSubCache() {
	subCache.Range(func(key, _ any) bool {
		subCache.Delete(key)
		return true
	})
}

func SetAfterSubscribe(f func()) { afterSubscribe = f }
