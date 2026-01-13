import { Resume, JobDescription } from "../types";

const DB_NAME = "ResumeMatchDB";
const DB_VERSION = 1;
const RESUME_STORE = "resumes";
const JD_STORE = "job_descriptions";

/**
 * 初始化 IndexedDB 数据库
 */
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("IndexedDB 打开失败:", request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // 创建简历存储
            if (!db.objectStoreNames.contains(RESUME_STORE)) {
                const resumeStore = db.createObjectStore(RESUME_STORE, {
                    keyPath: "id",
                });
                resumeStore.createIndex("createdAt", "createdAt", { unique: false });
            }

            // 创建岗位需求存储
            if (!db.objectStoreNames.contains(JD_STORE)) {
                const jdStore = db.createObjectStore(JD_STORE, { keyPath: "id" });
                jdStore.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
    });
}

/**
 * 简历存储服务（本地 IndexedDB）
 */
export const ResumeStorage = {
    // 获取所有简历
    async fetchAll(): Promise<Resume[]> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(RESUME_STORE, "readonly");
                const store = transaction.objectStore(RESUME_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    // 按创建时间倒序排列
                    const results = (request.result || []).sort(
                        (a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0),
                    );
                    resolve(results);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error("Error fetching resumes:", error);
            return [];
        }
    },

    // 保存或更新简历
    async save(resume: Resume): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(RESUME_STORE, "readwrite");
                const store = transaction.objectStore(RESUME_STORE);
                // 添加创建时间戳
                const dataToSave = { ...resume, createdAt: Date.now() };
                const request = store.put(dataToSave);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error saving resume:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error saving resume:", error);
        }
    },

    // 删除指定的简历列表
    async deleteAll(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        try {
            const db = await openDB();
            const transaction = db.transaction(RESUME_STORE, "readwrite");
            const store = transaction.objectStore(RESUME_STORE);

            for (const id of ids) {
                store.delete(id);
            }

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.error("Error deleting resumes:", error);
            throw error;
        }
    },

    // 清空整个表
    async clearTable(): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(RESUME_STORE, "readwrite");
                const store = transaction.objectStore(RESUME_STORE);
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error clearing resumes:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error clearing resumes table:", error);
            throw error;
        }
    },

    // 删除单个简历
    async deleteOne(id: string): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(RESUME_STORE, "readwrite");
                const store = transaction.objectStore(RESUME_STORE);
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error deleting resume:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error deleting resume:", error);
        }
    },
};

/**
 * 岗位需求存储服务（本地 IndexedDB）
 */
export const JDStorage = {
    // 获取所有岗位
    async fetchAll(): Promise<JobDescription[]> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(JD_STORE, "readonly");
                const store = transaction.objectStore(JD_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    // 按创建时间倒序排列
                    const results = (request.result || []).sort(
                        (a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0),
                    );
                    resolve(results);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error("Error fetching JDs:", error);
            return [];
        }
    },

    // 保存或更新岗位
    async save(jd: JobDescription): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(JD_STORE, "readwrite");
                const store = transaction.objectStore(JD_STORE);
                // 添加创建时间戳
                const dataToSave = { ...jd, createdAt: Date.now() };
                const request = store.put(dataToSave);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error saving JD:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error saving JD:", error);
        }
    },

    // 删除指定的岗位列表
    async deleteAll(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        try {
            const db = await openDB();
            const transaction = db.transaction(JD_STORE, "readwrite");
            const store = transaction.objectStore(JD_STORE);

            for (const id of ids) {
                store.delete(id);
            }

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.error("Error deleting JDs:", error);
            throw error;
        }
    },

    // 清空整个表
    async clearTable(): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(JD_STORE, "readwrite");
                const store = transaction.objectStore(JD_STORE);
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error clearing JDs:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error clearing JDs table:", error);
            throw error;
        }
    },

    // 删除单个岗位
    async deleteOne(id: string): Promise<void> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(JD_STORE, "readwrite");
                const store = transaction.objectStore(JD_STORE);
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Error deleting JD:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("Error deleting JD:", error);
        }
    },
};
