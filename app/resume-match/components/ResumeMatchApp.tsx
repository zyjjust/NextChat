"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Header } from './Header';
import { Resume, JobDescription, MatchResult, UsageMetrics, MatchModelType } from '../types';
import { parseFile } from '../services/fileParser';
import { parseResumeWithAI, parseJDWithAI, parseJDBatchWithAI, matchResumeToJDs, BatchJDInput } from '../services/geminiService';
import { ResumeStorage, JDStorage } from '../services/storageService';
import styles from '../resume-match.module.scss';
import clsx from 'clsx';

export const ResumeMatchApp: React.FC = () => {
    const [resumes, setResumes] = useState<Resume[]>([]);
    const [jds, setJds] = useState<JobDescription[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // 专门用于 JD 文件的处理队列状态
    const [processingJDFiles, setProcessingJDFiles] = useState<{ name: string, id: string }[]>([]);

    const [selectedResumes, setSelectedResumes] = useState<Set<string>>(new Set());
    const [selectedJds, setSelectedJds] = useState<Set<string>>(new Set());
    const [matchResults, setMatchResults] = useState<MatchResult[]>([]);

    // 报告折叠状态管理：存储已展开的 resumeId
    const [expandedResultIds, setExpandedResultIds] = useState<Set<string>>(new Set());

    // 模型选择状态
    const [selectedMatchModel, setSelectedMatchModel] = useState<MatchModelType>('gemini-3-flash-preview');

    // 匹配状态
    const [isMatching, setIsMatching] = useState(false);
    const [matchProgress, setMatchProgress] = useState({ current: 0, total: 0 });

    // 统计数据
    const [taskStats, setTaskStats] = useState<{
        startTime: number | null;
        endTime: number | null;
        durationMs: number;
        usage: UsageMetrics;
    }>({
        startTime: null,
        endTime: null,
        durationMs: 0,
        usage: { promptTokens: 0, outputTokens: 0, totalCost: 0 }
    });

    // 隐藏的文件输入框引用
    const resumeInputRef = useRef<HTMLInputElement>(null);
    const jdInputRef = useRef<HTMLInputElement>(null);

    // 初始化加载数据
    useEffect(() => {
        const loadData = async () => {
            try {
                const [loadedResumes, loadedJDs] = await Promise.all([
                    ResumeStorage.fetchAll(),
                    JDStorage.fetchAll()
                ]);
                setResumes(loadedResumes);
                setJds(loadedJDs);
            } catch (e) {
                console.error("初始化数据加载失败:", e);
            } finally {
                setIsLoadingData(false);
            }
        };
        loadData();
    }, []);

    const handleResumeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleResumeUpload(Array.from(e.target.files));
            e.target.value = '';
        }
    };

    const handleJDFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleJDUpload(Array.from(e.target.files));
            e.target.value = '';
        }
    };

    const handleResumeUpload = (files: File[]) => {
        const tempResumes: Resume[] = files.map(file => ({
            id: Math.random().toString(36).substr(2, 9),
            fileName: file.name,
            fileType: file.type,
            rawContent: '',
            status: 'analyzing'
        }));

        // 乐观更新 UI
        setResumes(prev => [...prev, ...tempResumes]);

        // 默认选中新上传的
        const newIds = tempResumes.map(r => r.id);
        setSelectedResumes(prev => {
            const newSet = new Set(prev);
            newIds.forEach(id => newSet.add(id));
            return newSet;
        });

        files.forEach(async (file, index) => {
            const tempId = tempResumes[index].id;
            let finalResume: Resume | null = null;

            try {
                const text = await parseFile(file);
                const parsed = await parseResumeWithAI(text);

                // 构建最终对象
                finalResume = {
                    ...tempResumes[index],
                    rawContent: text,
                    parsedData: parsed,
                    status: 'done'
                };

                // 更新状态
                setResumes(prev => prev.map(r => r.id === tempId ? finalResume! : r));

                // 【关键】持久化到 IndexedDB
                await ResumeStorage.save(finalResume);

            } catch (error) {
                console.error(`Error parsing resume ${file.name}:`, error);
                setResumes(prev => prev.map(r =>
                    r.id === tempId ? { ...r, status: 'error' } : r
                ));
            }
        });
    };

    const handleJDUpload = (files: File[]) => {
        const fileTasks = files.map(f => ({ name: f.name, id: Math.random().toString(36).substr(2, 9) }));
        setProcessingJDFiles(prev => [...prev, ...fileTasks]);

        files.forEach(async (file, index) => {
            const taskId = fileTasks[index].id;
            const extension = file.name.split('.').pop()?.toLowerCase();

            try {
                let text = '';
                let isExcel = extension === 'xlsx' || extension === 'xls';

                if (isExcel) {
                    const data = await file.arrayBuffer();
                    const XLSX = (window as any).XLSX;
                    const workbook = XLSX.read(data);
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    // 第一步：收集所有有效行数据
                    const batchInputs: BatchJDInput[] = [];
                    const rowMetadata: { rowIndex: number; jdId: string; title: string; rawContent: string; keyClarification: string }[] = [];

                    for (let i = 1; i < jsonData.length; i++) {
                        const row = jsonData[i] as any[];
                        if (!row || row.length === 0) continue;

                        const rawJDInfo = row.slice(0, 4).filter(Boolean).join('\n');
                        const keyClarification = row[4] ? String(row[4]) : '';

                        if (rawJDInfo.trim()) {
                            const jdId = (row[0] && String(row[0]).trim()) || Math.random().toString(36).substr(2, 9);
                            const title = (row[1] && String(row[1]).trim()) || '未命名需求';

                            batchInputs.push({
                                rowIndex: i,
                                jobCode: jdId,
                                title: title,
                                rawContent: rawJDInfo,
                                keyClarification: keyClarification
                            });

                            rowMetadata.push({
                                rowIndex: i,
                                jdId,
                                title,
                                rawContent: rawJDInfo,
                                keyClarification
                            });
                        }
                    }

                    if (batchInputs.length === 0) {
                        alert('Excel 中没有找到有效的岗位数据');
                    } else {
                        console.log(`[JD Import] 开始批量解析 ${batchInputs.length} 个岗位...`);

                        // 第二步：一次性调用批量 API
                        const parsedResults = await parseJDBatchWithAI(batchInputs);

                        console.log(`[JD Import] 批量解析完成，返回 ${parsedResults.length} 个结果`);

                        // 第三步：将结果映射回原始数据并更新 UI
                        const newJds: JobDescription[] = [];

                        for (const parsed of parsedResults) {
                            const meta = rowMetadata.find(m => m.rowIndex === parsed.rowIndex);
                            if (meta) {
                                const newJd: JobDescription = {
                                    id: meta.jdId,
                                    title: meta.title,
                                    fileName: file.name,
                                    rawContent: meta.rawContent,
                                    parsedData: {
                                        jobCode: parsed.jobCode,
                                        title: parsed.title,
                                        keyClarification: meta.keyClarification || parsed.keyClarification,
                                        description: parsed.description,
                                        responsibilities: parsed.responsibilities,
                                        requirements: parsed.requirements
                                    }
                                };
                                newJds.push(newJd);
                            }
                        }

                        // 批量更新 UI
                        if (newJds.length > 0) {
                            setJds(prev => {
                                const updatedList = [...prev];
                                newJds.forEach(newJd => {
                                    const existingIndex = updatedList.findIndex(j => j.id === newJd.id);
                                    if (existingIndex !== -1) {
                                        updatedList[existingIndex] = newJd;
                                    } else {
                                        updatedList.push(newJd);
                                    }
                                });
                                return updatedList;
                            });

                            setSelectedJds(prev => {
                                const newSet = new Set(prev);
                                newJds.forEach(jd => newSet.add(jd.id));
                                return newSet;
                            });

                            // 批量持久化
                            for (const jd of newJds) {
                                await JDStorage.save(jd);
                            }
                        }

                        // 检查是否有未解析成功的行
                        const failedCount = batchInputs.length - parsedResults.length;
                        if (failedCount > 0) {
                            alert(`导入完成，成功 ${parsedResults.length} 个，失败 ${failedCount} 个`);
                        }
                    }
                } else {
                    // 非 Excel 文件走原来的逻辑
                    text = await parseFile(file);
                    const parsedList = await parseJDWithAI(text);

                    if (parsedList && parsedList.length > 0) {
                        const newJDs: JobDescription[] = parsedList.map(parsed => ({
                            id: parsed.jobCode && parsed.jobCode.trim() !== '' ? parsed.jobCode : Math.random().toString(36).substr(2, 9),
                            title: parsed.title || '未命名需求',
                            fileName: file.name,
                            rawContent: text,
                            parsedData: parsed
                        }));

                        setJds(prev => {
                            const updatedList = [...prev];
                            newJDs.forEach(newJd => {
                                const existingIndex = updatedList.findIndex(j => j.id === newJd.id);
                                if (existingIndex !== -1) updatedList[existingIndex] = newJd;
                                else updatedList.push(newJd);
                            });
                            return updatedList;
                        });

                        const newIds = newJDs.map(j => j.id);
                        setSelectedJds(prev => {
                            const newSet = new Set(prev);
                            newIds.forEach(id => newSet.add(id));
                            return newSet;
                        });

                        for (const jd of newJDs) {
                            await JDStorage.save(jd);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing JD file ${file.name}:`, error);
                alert(`解析文件 ${file.name} 失败: ${error instanceof Error ? error.message : '未知错误'}`);
            } finally {
                setProcessingJDFiles(prev => prev.filter(task => task.id !== taskId));
            }
        });
    };

    const startMatching = async () => {
        if (selectedResumes.size === 0 || selectedJds.size === 0) {
            alert('请先勾选需要对比的简历和岗位。');
            return;
        }

        if (selectedResumes.size > 5 || selectedJds.size > 5) {
            alert('为了保证分析质量和速度，单次对比请不要超过 5 份简历和 5 个岗位。');
            return; // 阻止继续执行
        }

        const resumesToMatch = resumes.filter(r => selectedResumes.has(r.id) && r.status === 'done');
        const jdsToMatch = jds.filter(j => selectedJds.has(j.id));

        if (resumesToMatch.length === 0) {
            alert('所选简历尚未解析完成或解析失败。');
            return;
        }

        setIsMatching(true);
        setMatchResults([]);
        setExpandedResultIds(new Set());
        setMatchProgress({ current: 0, total: resumesToMatch.length });

        // 初始化统计数据
        const startTime = Date.now();
        setTaskStats({
            startTime,
            endTime: null,
            durationMs: 0,
            usage: { promptTokens: 0, outputTokens: 0, totalCost: 0 }
        });

        const MAX_CONCURRENT = 5;
        const queue = [...resumesToMatch];
        let completedCount = 0;
        const resultsBuffer: MatchResult[] = [];

        // 临时累加器，避免闭包问题
        let accumulatedPromptTokens = 0;
        let accumulatedOutputTokens = 0;
        let accumulatedTotalCost = 0;

        const worker = async (workerId: number) => {
            while (queue.length > 0) {
                const resume = queue.shift();
                if (!resume) break;

                try {
                    const { result, usage } = await matchResumeToJDs(resume, jdsToMatch, selectedMatchModel);
                    if (result && result.matches && result.matches.length > 0) {
                        resultsBuffer.push(result);
                        setMatchResults(prev => [...prev, result]);

                        // Gemini 3 Pro 定价策略
                        const inputPricePerM = usage.promptTokens > 200000 ? 4.00 : 2.00;
                        const outputPricePerM = usage.promptTokens > 200000 ? 18.00 : 12.00;

                        const requestCost = (usage.promptTokens / 1000000 * inputPricePerM) +
                            (usage.outputTokens / 1000000 * outputPricePerM);

                        accumulatedPromptTokens += usage.promptTokens;
                        accumulatedOutputTokens += usage.outputTokens;
                        accumulatedTotalCost += requestCost;

                        setTaskStats(prev => {
                            return {
                                ...prev,
                                usage: {
                                    promptTokens: accumulatedPromptTokens,
                                    outputTokens: accumulatedOutputTokens,
                                    totalCost: accumulatedTotalCost
                                }
                            };
                        });
                    } else {
                        // API 返回了结果但 matches 为空，创建一个错误占位结果
                        console.warn(`匹配结果为空: ${resume.parsedData?.name || resume.fileName}`);
                        const errorResult: MatchResult = {
                            resumeId: resume.id,
                            resumeName: resume.parsedData?.name || '未知候选人',
                            matches: [{
                                jdId: 'error',
                                jdTitle: '匹配失败',
                                score: 0,
                                comprehensiveEvaluation: 'AI 返回的匹配结果为空，请重试。',
                                strengths: [],
                                weaknesses: [],
                                improvementSuggestions: [],
                                isBestMatch: false
                            }]
                        };
                        resultsBuffer.push(errorResult);
                        setMatchResults(prev => [...prev, errorResult]);
                    }
                } catch (error) {
                    console.error(`Worker ${workerId} failed for ${resume.fileName}`, error);
                    const errorResult: MatchResult = {
                        resumeId: resume.id,
                        resumeName: resume.parsedData?.name || '未知候选人',
                        matches: [{
                            jdId: 'error',
                            jdTitle: '匹配出错',
                            score: 0,
                            comprehensiveEvaluation: `API 调用失败: ${error instanceof Error ? error.message : '未知错误'}`,
                            strengths: [],
                            weaknesses: [],
                            improvementSuggestions: ['请检查网络连接', '稍后重试'],
                            isBestMatch: false
                        }]
                    };
                    resultsBuffer.push(errorResult);
                    setMatchResults(prev => [...prev, errorResult]);
                } finally {
                    completedCount++;
                    setMatchProgress(prev => ({ ...prev, current: completedCount }));
                }
            }
        };

        const activeWorkers = Array(Math.min(MAX_CONCURRENT, resumesToMatch.length))
            .fill(null)
            .map((_, index) => worker(index));

        await Promise.all(activeWorkers);

        const endTime = Date.now();
        setIsMatching(false);

        setTaskStats(prev => ({
            ...prev,
            endTime,
            durationMs: endTime - startTime,
        }));

        if (resultsBuffer.length === 0) {
            alert('匹配完成，但未生成有效结果。');
        } else {
            setTimeout(() => {
                document.getElementById('report-section')?.scrollIntoView({ behavior: 'smooth' });
            }, 500);
        }
    };

    const toggleResumeSelection = (id: string) => {
        const newSet = new Set(selectedResumes);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedResumes(newSet);
    };

    const toggleJDSelection = (id: string) => {
        const newSet = new Set(selectedJds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedJds(newSet);
    };

    const selectAllResumes = () => {
        if (selectedResumes.size === resumes.length) {
            setSelectedResumes(new Set());
        } else {
            setSelectedResumes(new Set(resumes.map(r => r.id)));
        }
    };

    const selectAllJds = () => {
        if (selectedJds.size === jds.length) {
            setSelectedJds(new Set());
        } else {
            setSelectedJds(new Set(jds.map(j => j.id)));
        }
    };

    const deleteResumes = async (idsToDelete: string[]) => {
        if (idsToDelete.length === 0) return;
        if (window.confirm(`确定要删除选中的 ${idsToDelete.length} 份简历吗？`)) {
            try {
                await ResumeStorage.deleteAll(idsToDelete);
                setResumes(prev => prev.filter(r => !idsToDelete.includes(r.id)));
                setSelectedResumes(prev => {
                    const newSet = new Set(prev);
                    idsToDelete.forEach(id => newSet.delete(id));
                    return newSet;
                });
            } catch (error) {
                console.error(error);
                alert("删除失败");
            }
        }
    };

    const clearAllResumes = async () => {
        if (resumes.length === 0) return;
        if (window.confirm('警告：此操作将从数据库中永久删除所有候选人记录。是否继续？')) {
            try {
                await ResumeStorage.clearTable();
                setResumes([]);
                setSelectedResumes(new Set());
            } catch (error) {
                console.error(error);
            }
        }
    };

    const deleteJds = async (idsToDelete: string[]) => {
        if (idsToDelete.length === 0) return;
        if (window.confirm(`确定要删除选中的 ${idsToDelete.length} 个岗位需求吗？`)) {
            try {
                await JDStorage.deleteAll(idsToDelete);
                setJds(prev => prev.filter(j => !idsToDelete.includes(j.id)));
                setSelectedJds(prev => {
                    const newSet = new Set(prev);
                    idsToDelete.forEach(id => newSet.delete(id));
                    return newSet;
                });
            } catch (error) {
                console.error(error);
            }
        }
    };

    const clearAllJds = async () => {
        if (jds.length === 0 && processingJDFiles.length === 0) return;
        if (window.confirm('警告：此操作将从数据库中永久删除所有岗位需求记录。是否继续？')) {
            try {
                await JDStorage.clearTable();
                setJds([]);
                setProcessingJDFiles([]);
                setSelectedJds(new Set());
            } catch (error) {
                console.error(error);
            }
        }
    };

    const toggleResultExpansion = (id: string) => {
        setExpandedResultIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const formatDuration = (ms: number) => {
        const seconds = (ms / 1000).toFixed(2);
        return `${seconds}秒`;
    };

    if (isLoadingData) {
        return (
            <div className={styles.container}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                    <p>正在同步数据库...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Header selectedModel={selectedMatchModel} onModelChange={setSelectedMatchModel} />

            <input type="file" ref={resumeInputRef} onChange={handleResumeFileChange} accept=".pdf,.docx,.doc" multiple style={{ display: 'none' }} />
            <input type="file" ref={jdInputRef} onChange={handleJDFileChange} accept=".txt,.docx,.xlsx,.xls" multiple style={{ display: 'none' }} />

            <main className={styles["main-content"]}>

                {/* 核心引擎板块 */}
                <section id="match-engine" className={styles["engine-card"]}>

                    {/* Engine Header */}
                    <div className={styles["engine-header"]}>
                        <h1>智能简历匹配系统</h1>
                        <p>
                            请在下方上传并选择 <span className={styles["highlight-indigo"]}>候选人</span> 与 <span className={styles["highlight-purple"]}>目标岗位</span>，系统将自动开启多线程深度分析。
                        </p>
                    </div>

                    {/* Engine Body */}
                    <div className={styles["engine-body"]}>

                        {/* Candidates List */}
                        <div className={clsx(styles.section, styles.left)}>
                            <div className={styles["section-header"]}>
                                <div className={styles["title-group"]}>
                                    <div className={clsx(styles["number-badge"], styles.indigo)}>1</div>
                                    <h2>候选人管理</h2>
                                </div>
                                <button
                                    onClick={() => resumeInputRef.current?.click()}
                                    className={styles["btn-primary"]}
                                >
                                    上传简历
                                </button>
                            </div>
                            <div className={styles.toolbar}>
                                <span className={styles["text-truncate"]}>已选 {selectedResumes.size} / {resumes.length} 人</span>
                                <div className={styles["action-buttons"]}>
                                    <button onClick={selectAllResumes} className={clsx(styles["text-btn"], styles.indigo)}>
                                        {selectedResumes.size === resumes.length && resumes.length > 0 ? '取消全选' : '全选'}
                                    </button>
                                    {selectedResumes.size > 0 && (
                                        <button onClick={() => deleteResumes(Array.from(selectedResumes))} className={clsx(styles["text-btn"], styles.rose)}>
                                            删除选中
                                        </button>
                                    )}
                                    <button onClick={clearAllResumes} className={clsx(styles["text-btn"], styles.rose)}>清空</button>
                                </div>
                            </div>

                            <div className={styles["list-container"]}>
                                {resumes.length === 0 && (
                                    <div className={styles["empty-state"]}>
                                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        <p>暂无候选人</p>
                                    </div>
                                )}
                                {resumes.map(r => (
                                    <div
                                        key={r.id}
                                        onClick={() => r.status === 'done' && toggleResumeSelection(r.id)}
                                        className={clsx(styles["list-item"], styles.indigo, { [styles.selected]: selectedResumes.has(r.id) })}
                                        style={{ opacity: r.status !== 'done' ? 0.7 : 1 }}
                                    >
                                        <div className={styles["item-content"]}>
                                            <div className={styles.info}>
                                                <h3>{r.parsedData?.name || (r.status === 'analyzing' ? 'AI 解析中...' : '未知候选人')}</h3>
                                                <p style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{r.fileName}</p>
                                                {/* 技能标签 */}
                                                {r.parsedData?.skills && r.parsedData.skills.length > 0 && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
                                                        {r.parsedData.skills.slice(0, 5).map((skill: string, idx: number) => (
                                                            <span key={idx} style={{
                                                                fontSize: '0.65rem',
                                                                padding: '0.1rem 0.4rem',
                                                                background: '#f1f5f9',
                                                                color: '#475569',
                                                                borderRadius: '4px',
                                                                border: '1px solid #e2e8f0'
                                                            }}>
                                                                {skill}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={clsx(styles["check-mark"], { [styles["selected-indigo"]]: selectedResumes.has(r.id) })}>
                                                {selectedResumes.has(r.id) && "✓"}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* JD List */}
                        <div className={clsx(styles.section, styles.right)}>
                            <div className={styles["section-header"]}>
                                <div className={styles["title-group"]}>
                                    <div className={clsx(styles["number-badge"], styles.purple)}>2</div>
                                    <h2>岗位需求库</h2>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <a
                                        href="/resume-match/template/需求模版.xlsx"
                                        download="需求模版.xlsx"
                                        style={{
                                            fontSize: '0.75rem',
                                            color: '#9333ea',
                                            textDecoration: 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem'
                                        }}
                                    >
                                        📥 下载模版
                                    </a>
                                    <button
                                        onClick={() => jdInputRef.current?.click()}
                                        className={styles["btn-secondary"]}
                                    >
                                        导入需求
                                    </button>
                                </div>
                            </div>
                            <div className={styles.toolbar}>
                                <span className={styles["text-truncate"]}>已选 {selectedJds.size} / {jds.length} 个</span>
                                <div className={styles["action-buttons"]}>
                                    <button onClick={selectAllJds} className={clsx(styles["text-btn"], styles.purple)}>
                                        {selectedJds.size === jds.length && jds.length > 0 ? '取消全选' : '全选'}
                                    </button>
                                    {selectedJds.size > 0 && (
                                        <button onClick={() => deleteJds(Array.from(selectedJds))} className={clsx(styles["text-btn"], styles.rose)}>
                                            删除选中
                                        </button>
                                    )}
                                    <button onClick={clearAllJds} className={clsx(styles["text-btn"], styles.rose)}>清空</button>
                                </div>
                            </div>
                            <div className={styles["list-container"]}>
                                {jds.length === 0 && processingJDFiles.length === 0 && (
                                    <div className={styles["empty-state"]}>
                                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                        <p>暂无岗位需求</p>
                                    </div>
                                )}
                                {processingJDFiles.map(task => (
                                    <div key={task.id} className={styles["list-item"]}>
                                        <div className={styles["item-content"]}>
                                            <div className={styles.info}>
                                                <h3>正在解析需求文档...</h3>
                                                <p>{task.name}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {jds.map(jd => (
                                    <div
                                        key={jd.id}
                                        onClick={() => toggleJDSelection(jd.id)}
                                        className={clsx(styles["list-item"], styles.purple, { [styles.selected]: selectedJds.has(jd.id) })}
                                    >
                                        <div className={styles["item-content"]}>
                                            <div className={styles.info}>
                                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.2rem' }}>
                                                    <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem', background: '#f3e8ff', color: '#9333ea', borderRadius: '4px' }}>ID: {jd.id}</span>
                                                </div>
                                                <h3>{jd.title}</h3>
                                                <p style={{ color: '#94a3b8', fontSize: '0.75rem' }}>来源: {jd.fileName}</p>

                                                {/* 重点澄清 */}
                                                {jd.parsedData?.keyClarification && (
                                                    <div style={{
                                                        fontSize: '0.7rem',
                                                        color: '#b45309',
                                                        background: '#fffbeb',
                                                        padding: '0.4rem 0.5rem',
                                                        marginTop: '0.5rem',
                                                        borderRadius: '4px',
                                                        border: '1px solid #fde68a'
                                                    }}>
                                                        <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>⚠ 重点澄清 (最高优先级)</div>
                                                        <div style={{ color: '#92400e' }}>{jd.parsedData.keyClarification}</div>
                                                    </div>
                                                )}

                                                {/* 学历和经验要求 */}
                                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.7rem', color: '#64748b' }}>
                                                    {jd.parsedData?.requirements?.education && (
                                                        <span>{jd.parsedData.requirements.education}</span>
                                                    )}
                                                    {jd.parsedData?.requirements?.experience && (
                                                        <span>{jd.parsedData.requirements.experience}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className={clsx(styles["check-mark"], { [styles["selected-purple"]]: selectedJds.has(jd.id) })}>
                                                {selectedJds.has(jd.id) && "✓"}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Action Bar */}
                    <div className={styles["action-bar"]}>
                        {isMatching ? (
                            <div className={styles["progress-card"]}>
                                <div className={styles["progress-header"]}>
                                    <div className={styles["progress-title"]}>
                                        <div className={styles["progress-spinner"]}></div>
                                        <span>AI 正在深度分析中...</span>
                                    </div>
                                    <div className={styles["progress-count"]}>
                                        {matchProgress.current} <span>/ {matchProgress.total}</span>
                                    </div>
                                </div>
                                <div className={styles["progress-bar-container"]}>
                                    <div
                                        className={styles["progress-bar-fill"]}
                                        style={{ width: `${matchProgress.total > 0 ? (matchProgress.current / matchProgress.total) * 100 : 0}%` }}
                                    ></div>
                                </div>
                                <div className={styles["progress-stats"]}>
                                    <div className={styles["stat-item"]}>
                                        <div className={styles["stat-value"]}>
                                            {((Date.now() - (taskStats.startTime || Date.now())) / 1000).toFixed(2)}秒
                                        </div>
                                        <div className={styles["stat-label"]}>已用时长</div>
                                    </div>
                                    <div className={styles["stat-item"]}>
                                        <div className={styles["stat-value"]}>
                                            {taskStats.usage.promptTokens.toLocaleString()}
                                        </div>
                                        <div className={styles["stat-label"]}>输入 Tokens</div>
                                    </div>
                                    <div className={styles["stat-item"]}>
                                        <div className={styles["stat-value"]}>
                                            {taskStats.usage.outputTokens.toLocaleString()}
                                        </div>
                                        <div className={styles["stat-label"]}>输出 Tokens</div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={startMatching}
                                disabled={selectedResumes.size === 0 || selectedJds.size === 0}
                                className={styles["start-btn"]}
                            >
                                <span>
                                    ⚡ 立即开始分析 ({selectedResumes.size}人 × {selectedJds.size}岗)
                                </span>
                            </button>
                        )}
                        {!isMatching && (
                            <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                                系统将启动最多 5 个并发线程进行深度推理
                            </p>
                        )}
                    </div>
                </section>

                {/* 4. 匹配结果报告 */}
                <section id="report-section" className={styles["report-section"]}>
                    <div className={styles["report-header"]}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div className={styles["report-title"]}>
                                <h2>分析报告大屏</h2>
                                <p>深度模型生成的匹配评分与改进建议。</p>
                            </div>
                            {matchResults.length > 0 && (
                                <button
                                    onClick={() => setMatchResults([])}
                                    style={{ fontSize: '0.8rem', color: '#4ade80', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    清空分析记录
                                </button>
                            )}
                        </div>
                        {matchResults.length > 0 && taskStats.startTime && taskStats.endTime && (
                            <div className={styles["report-stats"]}>
                                <div className={styles["report-stat-item"]}>
                                    <div className={clsx(styles["stat-icon"], styles.time)}>⏱</div>
                                    <div className={styles["stat-info"]}>
                                        <div className={styles["stat-label"]}>实际耗时</div>
                                        <div className={styles["stat-value"]}>{formatDuration(taskStats.durationMs)}</div>
                                    </div>
                                </div>
                                <div className={styles["report-stat-item"]}>
                                    <div className={clsx(styles["stat-icon"], styles.token)}>🔢</div>
                                    <div className={styles["stat-info"]}>
                                        <div className={styles["stat-label"]}>TOKEN 消耗</div>
                                        <div className={styles["stat-value"]}>{(taskStats.usage.promptTokens + taskStats.usage.outputTokens).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className={styles["report-stat-item"]}>
                                    <div className={clsx(styles["stat-icon"], styles.cost)}>💰</div>
                                    <div className={styles["stat-info"]}>
                                        <div className={styles["stat-label"]}>预估成本</div>
                                        <div className={styles["stat-value"]}>${taskStats.usage.totalCost.toFixed(4)}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {matchResults.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: '1.5rem' }}>
                            <p>暂无分析数据</p>
                        </div>
                    ) : (
                        <div>
                            {matchResults.map((result) => {
                                const isExpanded = expandedResultIds.has(result.resumeId);
                                const bestMatch = result.matches.find(m => m.isBestMatch) || result.matches[0];
                                const hasRecommendation = result.matches.some(m => m.score >= 60);

                                return (
                                    <div key={result.resumeId} className={styles["result-card"]}>
                                        {/* 可点击的头部区域 */}
                                        <div
                                            onClick={() => toggleResultExpansion(result.resumeId)}
                                            className={clsx(styles["card-header"], { [styles.expanded]: isExpanded })}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                                                <div className={clsx(styles.avatar, { [styles.active]: isExpanded })}>
                                                    {result.resumeName.charAt(0)}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <h3 style={{ fontSize: '1.1rem', fontWeight: 900 }}>{result.resumeName}</h3>
                                                        {/* 最高分标签 */}
                                                        <span style={{
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            padding: '0.15rem 0.5rem',
                                                            borderRadius: '4px',
                                                            background: bestMatch.score >= 80 ? '#dcfce7' : bestMatch.score >= 60 ? '#fef9c3' : '#fee2e2',
                                                            color: bestMatch.score >= 80 ? '#16a34a' : bestMatch.score >= 60 ? '#ca8a04' : '#dc2626'
                                                        }}>
                                                            最高分: {bestMatch.score}
                                                        </span>
                                                    </div>
                                                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                                        已完成 {result.matches.length} 个岗位分析 ·
                                                        {hasRecommendation && bestMatch && (
                                                            <span style={{ color: '#6366f1' }}>
                                                                {' '}ID: {bestMatch.jdId.toUpperCase()} · 推荐: {bestMatch.jdTitle}
                                                            </span>
                                                        )}
                                                        {!hasRecommendation && <span> 暂无合适推荐</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: isExpanded ? '#4f46e5' : '#94a3b8' }}>
                                                {isExpanded ? '收起详情' : '查看详情'}
                                            </div>
                                        </div>

                                        {/* 展开的详情区域 */}
                                        {isExpanded && (
                                            <div className={styles["matches-container"]}>
                                                {result.matches.map((match, idx) => (
                                                    <div key={match.jdId} className={clsx(styles["match-item"], { [styles["best-match"]]: match.isBestMatch })}>
                                                        {match.isBestMatch && (
                                                            <div style={{ position: 'absolute', top: '-10px', right: '20px', background: '#4f46e5', color: 'white', padding: '2px 10px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                                                CORE MATCH
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexDirection: 'column' }}>
                                                            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <div>
                                                                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b' }}>ID: {match.jdId.toUpperCase()}</div>
                                                                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>{match.jdTitle}</h3>
                                                                </div>
                                                                <div className={clsx(styles["score-circle"],
                                                                    match.score >= 80 ? styles.high : match.score >= 60 ? styles.mid : styles.low
                                                                )}>
                                                                    {match.score}
                                                                </div>
                                                            </div>

                                                            <div style={{ background: 'white', padding: '1rem', borderRadius: '1rem', border: '1px solid #f1f5f9', width: '100%' }}>
                                                                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>{match.comprehensiveEvaluation}</p>
                                                            </div>

                                                            <div className={styles["analysis-grid"]}>
                                                                <div>
                                                                    <h4 className={styles.pros}>优势 (Pros)</h4>
                                                                    <ul>
                                                                        {match.strengths.map((s, i) => (
                                                                            <li key={i}><div className={clsx(styles.dot, styles.pros)}></div>{s}</li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                                <div>
                                                                    <h4 className={styles.cons}>劣势 (Cons)</h4>
                                                                    <ul>
                                                                        {match.weaknesses.map((s, i) => (
                                                                            <li key={i}><div className={clsx(styles.dot, styles.cons)}></div>{s}</li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                                <div>
                                                                    <h4 className={styles.plan}>建议 (Plan)</h4>
                                                                    <ul>
                                                                        {match.improvementSuggestions.map((s, i) => (
                                                                            <li key={i}><div className={clsx(styles.dot, styles.plan)}></div>{s}</li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
};
