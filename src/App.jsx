import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  clearShippingData,
  loadShippingData,
  saveShippingData,
} from "./db";
import "./App.css";

const STORAGE_KEY = "shipping-picking-data-v1";
const SORT_SETTINGS_KEY = "shipping-picking-sort-settings-v1";

const DEFAULT_SORT_RULES = [
  { field: "boxType", direction: "custom" },
  { field: "totalBoxes", direction: "desc" },
  { field: "lane", direction: "asc" },
];

const SORT_FIELD_OPTIONS = [
  { value: "boxType", label: "箱種" },
  { value: "totalBoxes", label: "箱数" },
  { value: "lane", label: "ロケ" },
  { value: "destinationName", label: "納入先" },
  { value: "partNumber", label: "品番" },
  { value: "deliveryDate", label: "納期" },
  { value: "orderNumber", label: "注文No." },
  { value: "importOrder", label: "取込順" },
];

const STATUS = {
  PENDING: "未作業",
  COMPLETED: "完了",
  HOLD: "保留",
};

const PICKING_MODE = {
  DETAIL: "detail",
  AGGREGATE: "aggregate",
};

function App() {
  const [shippingData, setShippingData] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState("import");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pickingMode, setPickingMode] = useState(PICKING_MODE.DETAIL);

  const [statusFilter, setStatusFilter] = useState("すべて");
  const [searchText, setSearchText] = useState("");
  const [listBoxJudgement, setListBoxJudgement] = useState("全部");
  const [sortRules, setSortRules] = useState(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(SORT_SETTINGS_KEY) || "{}"
      );

      return Array.isArray(saved.sortRules) && saved.sortRules.length === 3
        ? saved.sortRules
        : DEFAULT_SORT_RULES;
    } catch {
      return DEFAULT_SORT_RULES;
    }
  });

  const [boxTypeOrder, setBoxTypeOrder] = useState(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(SORT_SETTINGS_KEY) || "{}"
      );

      return Array.isArray(saved.boxTypeOrder)
        ? saved.boxTypeOrder
        : [];
    } catch {
      return [];
    }
  });
  const [showAllDatesInList, setShowAllDatesInList] = useState(false);

  const [importMessage, setImportMessage] = useState("");
  const [fileName, setFileName] = useState("");

  const [workShippingDate, setWorkShippingDate] = useState("");
  const [workDeliveryDate, setWorkDeliveryDate] = useState("すべて");
  const [workDestination, setWorkDestination] = useState("すべて");
  const [workLane, setWorkLane] = useState("すべて");
  const [workBoxType, setWorkBoxType] = useState("すべて");
  const [workBoxJudgement, setWorkBoxJudgement] = useState("全部");
  const [workStatus, setWorkStatus] = useState("未作業・保留");
  const [workStarted, setWorkStarted] = useState(false);
  const [workTargetIds, setWorkTargetIds] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const initializeData = async () => {
      try {
        let savedData = await loadShippingData();

        if (savedData.length === 0) {
          const oldSavedData = localStorage.getItem(STORAGE_KEY);

          if (oldSavedData) {
            const parsedData = JSON.parse(oldSavedData);

            if (Array.isArray(parsedData)) {
              savedData = parsedData;
              await saveShippingData(parsedData);
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        }

        if (isMounted) {
          setShippingData(savedData);
        }
      } catch (error) {
        console.error("保存データの読込に失敗しました。", error);
        window.alert("保存データの読込に失敗しました。");
      } finally {
        if (isMounted) {
          setIsDataLoaded(true);
        }
      }
    };

    initializeData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isDataLoaded) {
      return undefined;
    }

    const timerId = window.setTimeout(async () => {
      try {
        await saveShippingData(shippingData);
      } catch (error) {
        console.error("保存データの更新に失敗しました。", error);
      }
    }, 300);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [shippingData, isDataLoaded]);

  useEffect(() => {
    const detectedBoxTypes = createUniqueOptions(
      shippingData.map((item) => item.boxType)
    );

    setBoxTypeOrder((previousOrder) => {
      const kept = previousOrder.filter((value) =>
        detectedBoxTypes.includes(value)
      );

      const added = detectedBoxTypes.filter(
        (value) => !kept.includes(value)
      );

      const nextOrder = [...kept, ...added];

      return JSON.stringify(nextOrder) === JSON.stringify(previousOrder)
        ? previousOrder
        : nextOrder;
    });
  }, [shippingData]);

  useEffect(() => {
    localStorage.setItem(
      SORT_SETTINGS_KEY,
      JSON.stringify({
        sortRules,
        boxTypeOrder,
      })
    );
  }, [sortRules, boxTypeOrder]);

  const sortedData = useMemo(() => {
    const copiedData = [...shippingData];

    return copiedData.sort((a, b) => {
      for (const rule of sortRules) {
        const result = compareBySortRule(
          a,
          b,
          rule,
          boxTypeOrder
        );

        if (result !== 0) {
          return result;
        }
      }

      return toNumber(a.importOrder) - toNumber(b.importOrder);
    });
  }, [shippingData, sortRules, boxTypeOrder]);

  const filteredData = useMemo(() => {
    const normalizedSearch = normalizeText(searchText);

    return sortedData.filter((item) => {
      const matchesShippingDate =
        showAllDatesInList ||
        !workShippingDate ||
        item.shippingDate === workShippingDate;

      const matchesStatus =
        statusFilter === "すべて" || item.status === statusFilter;

      const targetText = normalizeText(
        [
          item.partNumber,
          item.orderNumber,
          item.destinationCode,
          item.destinationName,
          item.lane,
          item.boxType,
          item.inspectionNumber,
          item.shippingDate,
          item.deliveryDate,
        ].join(" ")
      );

      const matchesSearch =
        normalizedSearch === "" || targetText.includes(normalizedSearch);

      let matchesBoxJudgement = true;

      if (listBoxJudgement === "端数のみ") {
        matchesBoxJudgement = toNumber(item.partialBoxes) > 0;
      } else if (listBoxJudgement === "整数のみ") {
        matchesBoxJudgement =
          toNumber(item.fullBoxes) > 0 &&
          toNumber(item.partialBoxes) === 0;
      }

      return (
        matchesShippingDate &&
        matchesStatus &&
        matchesSearch &&
        matchesBoxJudgement
      );
    });
  }, [
    sortedData,
    statusFilter,
    searchText,
    listBoxJudgement,
    workShippingDate,
    showAllDatesInList,
  ]);

  const selectedDateData = useMemo(() => {
    return sortedData.filter((item) => {
      return (
        showAllDatesInList ||
        !workShippingDate ||
        item.shippingDate === workShippingDate
      );
    });
  }, [sortedData, showAllDatesInList, workShippingDate]);

  const listHoldCount = selectedDateData.filter(
    (item) => item.status === STATUS.HOLD
  ).length;

  const shippingDateOptions = useMemo(() => {
    return createUniqueOptions(
      shippingData.map((item) => item.shippingDate)
    );
  }, [shippingData]);

  useEffect(() => {
    if (shippingDateOptions.length === 0) {
      setWorkShippingDate("");
      return;
    }

    if (!shippingDateOptions.includes(workShippingDate)) {
      setWorkShippingDate(shippingDateOptions[0]);
      setWorkDeliveryDate("すべて");
      setWorkDestination("すべて");
      setWorkLane("すべて");
      setWorkBoxType("すべて");
      setWorkBoxJudgement("全部");
    }
  }, [shippingDateOptions, workShippingDate]);

  const deliveryDateOptions = useMemo(() => {
    const filtered = shippingData.filter((item) => {
      return !workShippingDate || item.shippingDate === workShippingDate;
    });

    return createUniqueOptions(
      filtered.map((item) => item.deliveryDate)
    );
  }, [shippingData, workShippingDate]);

  const destinationOptions = useMemo(() => {
    const filtered = shippingData.filter((item) => {
      const matchesShippingDate =
        !workShippingDate || item.shippingDate === workShippingDate;

      const matchesDeliveryDate =
        workDeliveryDate === "すべて" ||
        item.deliveryDate === workDeliveryDate;

      return matchesShippingDate && matchesDeliveryDate;
    });

    return createUniqueOptions(
      filtered.map((item) => item.destinationName)
    );
  }, [shippingData, workShippingDate, workDeliveryDate]);

  const laneOptions = useMemo(() => {
    const filtered = shippingData.filter((item) => {
      const matchesShippingDate =
        !workShippingDate || item.shippingDate === workShippingDate;

      const matchesDeliveryDate =
        workDeliveryDate === "すべて" ||
        item.deliveryDate === workDeliveryDate;

      const matchesDestination =
        workDestination === "すべて" ||
        item.destinationName === workDestination;

      return (
        matchesShippingDate &&
        matchesDeliveryDate &&
        matchesDestination
      );
    });

    return createUniqueOptions(filtered.map((item) => item.lane));
  }, [
    shippingData,
    workShippingDate,
    workDeliveryDate,
    workDestination,
  ]);

  const boxTypeOptions = useMemo(() => {
    const filtered = shippingData.filter((item) => {
      const matchesShippingDate =
        !workShippingDate || item.shippingDate === workShippingDate;

      const matchesDeliveryDate =
        workDeliveryDate === "すべて" ||
        item.deliveryDate === workDeliveryDate;

      const matchesDestination =
        workDestination === "すべて" ||
        item.destinationName === workDestination;

      const matchesLane =
        workLane === "すべて" || item.lane === workLane;

      return (
        matchesShippingDate &&
        matchesDeliveryDate &&
        matchesDestination &&
        matchesLane
      );
    });

    return createUniqueOptions(filtered.map((item) => item.boxType));
  }, [
    shippingData,
    workShippingDate,
    workDeliveryDate,
    workDestination,
    workLane,
  ]);

  const selectedWorkData = useMemo(() => {
    return sortedData.filter((item) => {
      const matchesShippingDate =
        !!workShippingDate &&
        item.shippingDate === workShippingDate;

      const matchesDeliveryDate =
        workDeliveryDate === "すべて" ||
        item.deliveryDate === workDeliveryDate;

      const matchesDestination =
        workDestination === "すべて" ||
        item.destinationName === workDestination;

      const matchesLane =
        workLane === "すべて" || item.lane === workLane;

      const matchesBoxType =
        workBoxType === "すべて" || item.boxType === workBoxType;

      let matchesBoxJudgement = true;

      if (workBoxJudgement === "端数のみ") {
        matchesBoxJudgement = toNumber(item.partialBoxes) > 0;
      } else if (workBoxJudgement === "整数のみ") {
        matchesBoxJudgement =
          toNumber(item.fullBoxes) > 0 &&
          toNumber(item.partialBoxes) === 0;
      }

      let matchesStatus = true;

      if (workStatus === "未作業・保留") {
        matchesStatus = item.status !== STATUS.COMPLETED;
      } else if (workStatus === "未作業のみ") {
        matchesStatus = item.status === STATUS.PENDING;
      } else if (workStatus === "保留のみ") {
        matchesStatus = item.status === STATUS.HOLD;
      }

      return (
        matchesShippingDate &&
        matchesDeliveryDate &&
        matchesDestination &&
        matchesLane &&
        matchesBoxType &&
        matchesBoxJudgement &&
        matchesStatus
      );
    });
  }, [
    sortedData,
    workShippingDate,
    workDeliveryDate,
    workDestination,
    workLane,
    workBoxType,
    workBoxJudgement,
    workStatus,
  ]);

  const workTargetData = useMemo(() => {
    if (!workStarted || workTargetIds.length === 0) {
      return [];
    }

    const targetIdSet = new Set(workTargetIds);

    return sortedData.filter((item) =>
      targetIdSet.has(String(item.shippingDataId))
    );
  }, [sortedData, workStarted, workTargetIds]);

  const pickingData = useMemo(() => {
    return workTargetData.filter(
      (item) => item.status !== STATUS.COMPLETED
    );
  }, [workTargetData]);

  const aggregateWorkData = useMemo(() => {
    return createPartAggregates(workTargetData, boxTypeOrder);
  }, [workTargetData, boxTypeOrder]);

  const aggregatePickingData = useMemo(() => {
    return createPartAggregates(pickingData, boxTypeOrder);
  }, [pickingData, boxTypeOrder]);

  const activePickingCount =
    pickingMode === PICKING_MODE.AGGREGATE
      ? aggregatePickingData.length
      : pickingData.length;

  useEffect(() => {
    if (activePickingCount === 0) {
      setCurrentIndex(0);
      return;
    }

    if (currentIndex >= activePickingCount) {
      setCurrentIndex(activePickingCount - 1);
    }
  }, [activePickingCount, currentIndex]);

  const currentItem =
    pickingMode === PICKING_MODE.DETAIL
      ? pickingData[currentIndex] ?? null
      : null;

  const currentAggregate =
    pickingMode === PICKING_MODE.AGGREGATE
      ? aggregatePickingData[currentIndex] ?? null
      : null;

  const selectedWorkCount = selectedWorkData.length;
  const selectedWorkPartCount = new Set(
    selectedWorkData.map((item) => item.partNumber).filter(Boolean)
  ).size;
  const selectedWorkBoxes = selectedWorkData.reduce(
    (total, item) => total + toNumber(item.totalBoxes),
    0
  );
  const selectedWorkQuantity = selectedWorkData.reduce(
    (total, item) => total + toNumber(item.quantity),
    0
  );

  const workTotalCount = workTargetData.length;
  const workCompletedCount = workTargetData.filter(
    (item) => item.status === STATUS.COMPLETED
  ).length;
  const workRemainingCount = workTotalCount - workCompletedCount;

  const workTotalPartCount = aggregateWorkData.length;
  const workCompletedPartCount = aggregateWorkData.filter((group) =>
    group.items.every((item) => item.status === STATUS.COMPLETED)
  ).length;
  const workRemainingPartCount =
    workTotalPartCount - workCompletedPartCount;

  const workTotalBoxes = workTargetData.reduce(
    (total, item) => total + toNumber(item.totalBoxes),
    0
  );
  const workCompletedBoxes = workTargetData
    .filter((item) => item.status === STATUS.COMPLETED)
    .reduce((total, item) => total + toNumber(item.totalBoxes), 0);

  const workProgress =
    workTotalBoxes > 0
      ? Math.round((workCompletedBoxes / workTotalBoxes) * 1000) / 10
      : 0;

  const updateSortRule = (index, key, value) => {
    setSortRules((previousRules) =>
      previousRules.map((rule, ruleIndex) => {
        if (ruleIndex !== index) {
          return rule;
        }

        if (key === "field") {
          return {
            field: value,
            direction: value === "boxType" ? "custom" : "asc",
          };
        }

        return {
          ...rule,
          [key]: value,
        };
      })
    );

    setCurrentIndex(0);
  };

  const updateBoxTypeOrder = (index, selectedBoxType) => {
    setBoxTypeOrder((previousOrder) => {
      const copiedOrder = [...previousOrder];
      const selectedIndex = copiedOrder.indexOf(selectedBoxType);

      if (selectedIndex === -1 || selectedIndex === index) {
        return previousOrder;
      }

      // 同じ箱種が二重にならないよう、選択した箱種と現在位置を入れ替える
      [copiedOrder[index], copiedOrder[selectedIndex]] = [
        copiedOrder[selectedIndex],
        copiedOrder[index],
      ];

      return copiedOrder;
    });

    setCurrentIndex(0);
  };

  const resetSortSettings = () => {
    setSortRules(DEFAULT_SORT_RULES);
    setBoxTypeOrder(
      createUniqueOptions(
        shippingData.map((item) => item.boxType)
      )
    );
    setCurrentIndex(0);
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImportMessage("");
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: "array",
        cellDates: false,
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error("シートが見つかりません。");
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const headerRowIndex = findHeaderRow(rows);

      if (headerRowIndex === -1) {
        throw new Error(
          "「矢崎品番」「発注数」「注文番号」などの見出し行を確認できません。"
        );
      }

      const headers = rows[headerRowIndex].map((header) =>
        String(header).trim()
      );

      const convertedData = rows
        .slice(headerRowIndex + 1)
        .map((row, index) =>
          convertRowToShippingData(row, headers, index)
        )
        .filter((item) => item !== null);

      if (convertedData.length === 0) {
        throw new Error("取り込める出荷データがありません。");
      }

      const existingIds = new Set(
        shippingData.map((item) => String(item.shippingDataId))
      );

      const newData = [];
      let duplicateCount = 0;

      convertedData.forEach((item) => {
        if (existingIds.has(String(item.shippingDataId))) {
          duplicateCount += 1;
          return;
        }

        existingIds.add(String(item.shippingDataId));

        newData.push({
          ...item,
          importOrder: shippingData.length + newData.length,
          importFileName: file.name,
          importedAt: new Date().toISOString(),
        });
      });

      if (newData.length === 0) {
        setImportMessage(
          `取込対象はすべて登録済みです。重複：${duplicateCount.toLocaleString()}件`
        );
        return;
      }

      setShippingData((previousData) => [...previousData, ...newData]);

      setImportMessage(
        [
          `${newData.length.toLocaleString()}件を取り込みました。`,
          `総箱数：${newData
            .reduce(
              (total, item) => total + toNumber(item.totalBoxes),
              0
            )
            .toLocaleString()}箱`,
          duplicateCount > 0
            ? `重複除外：${duplicateCount.toLocaleString()}件`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (error) {
      console.error(error);
      setImportMessage(`取込エラー：${error.message}`);
    }
  };

  const updateStatus = (shippingDataId, newStatus) => {
    setShippingData((previousData) =>
      previousData.map((item) => {
        if (String(item.shippingDataId) !== String(shippingDataId)) {
          return item;
        }

        return {
          ...item,
          status: newStatus,
          completedAt:
            newStatus === STATUS.COMPLETED
              ? new Date().toISOString()
              : "",
          holdAt:
            newStatus === STATUS.HOLD
              ? new Date().toISOString()
              : "",
          holdReason:
            newStatus === STATUS.HOLD ? item.holdReason || "" : "",
          isExported:
            newStatus === STATUS.COMPLETED
              ? false
              : item.isExported ?? false,
          exportedAt:
            newStatus === STATUS.COMPLETED
              ? ""
              : item.exportedAt || "",
        };
      })
    );
  };

  const updateStatusesByIds = (
    shippingDataIds,
    newStatus,
    holdReason = ""
  ) => {
    const targetIdSet = new Set(
      shippingDataIds.map((id) => String(id))
    );

    setShippingData((previousData) =>
      previousData.map((item) => {
        if (!targetIdSet.has(String(item.shippingDataId))) {
          return item;
        }

        return {
          ...item,
          status: newStatus,
          completedAt:
            newStatus === STATUS.COMPLETED
              ? new Date().toISOString()
              : "",
          holdAt:
            newStatus === STATUS.HOLD
              ? new Date().toISOString()
              : "",
          holdReason:
            newStatus === STATUS.HOLD ? holdReason : "",
          isExported: false,
          exportedAt: "",
        };
      })
    );
  };

  const askHoldReason = () => {
    const input = window.prompt(
      [
        "保留理由を番号で入力してください。",
        "",
        "1：在庫不足",
        "2：現品なし",
        "3：品番確認",
        "4：数量確認",
        "5：納入先確認",
        "6：その他",
      ].join("\n")
    );

    if (input === null) {
      return null;
    }

    const reasonMap = {
      1: "在庫不足",
      2: "現品なし",
      3: "品番確認",
      4: "数量確認",
      5: "納入先確認",
      6: "その他",
    };

    const selectedReason = reasonMap[String(input).trim()];

    if (!selectedReason) {
      window.alert("1～6の番号を入力してください。");
      return null;
    }

    if (selectedReason !== "その他") {
      return selectedReason;
    }

    const customReason = window.prompt("保留理由を入力してください。");

    if (customReason === null) {
      return null;
    }

    if (customReason.trim() === "") {
      window.alert("保留理由を入力してください。");
      return null;
    }

    return customReason.trim();
  };

  const completeCurrentAggregate = () => {
    if (!currentAggregate) {
      return;
    }

    const firstApproved = window.confirm(
      [
        `品番：${currentAggregate.partNumber || "-"}`,
        `合計数量：${currentAggregate.quantity.toLocaleString()}個`,
        `合計箱数：${currentAggregate.totalBoxes.toLocaleString()}箱`,
        `整数箱：${currentAggregate.fullBoxes.toLocaleString()}箱`,
        `端数箱：${currentAggregate.partialBoxes.toLocaleString()}箱`,
        `対象明細：${currentAggregate.detailCount.toLocaleString()}件`,
        "",
        "この品番のトータルピッキングを完了しますか？",
      ].join("\n")
    );

    if (!firstApproved) {
      return;
    }

    const secondApproved = window.confirm(
      [
        `${currentAggregate.detailCount.toLocaleString()}件の明細を`,
        "まとめて完了状態にします。",
        "",
        "内訳を確認済みですか？",
      ].join("\n")
    );

    if (!secondApproved) {
      return;
    }

    updateStatusesByIds(
      currentAggregate.items.map((item) => item.shippingDataId),
      STATUS.COMPLETED
    );
  };

  const holdCurrentAggregate = () => {
    if (!currentAggregate) {
      return;
    }

    const holdReason = askHoldReason();

    if (!holdReason) {
      return;
    }

    updateStatusesByIds(
      currentAggregate.items.map((item) => item.shippingDataId),
      STATUS.HOLD,
      holdReason
    );

    if (currentIndex < aggregatePickingData.length - 1) {
      setCurrentIndex((previousIndex) => previousIndex + 1);
    }
  };

  const completeCurrentItem = () => {
    if (!currentItem) {
      return;
    }

    const approved = window.confirm(
      [
        `品番：${currentItem.partNumber || "-"}`,
        `ロケ：${currentItem.lane || "-"}`,
        `箱数：${toNumber(currentItem.totalBoxes).toLocaleString()}箱`,
        `数量：${toNumber(currentItem.quantity).toLocaleString()}個`,
        "",
        "この作業を完了しますか？",
      ].join("\n")
    );

    if (!approved) {
      return;
    }

    updateStatus(currentItem.shippingDataId, STATUS.COMPLETED);
  };

  const holdCurrentItem = () => {
    if (!currentItem) {
      return;
    }

    const input = window.prompt(
      [
        `品番：${currentItem.partNumber || "-"}`,
        `ロケ：${currentItem.lane || "-"}`,
        "",
        "保留理由を番号で入力してください。",
        "",
        "1：在庫不足",
        "2：現品なし",
        "3：品番確認",
        "4：数量確認",
        "5：納入先確認",
        "6：その他",
      ].join("\n")
    );

    if (input === null) {
      return;
    }

    const reasonMap = {
      1: "在庫不足",
      2: "現品なし",
      3: "品番確認",
      4: "数量確認",
      5: "納入先確認",
      6: "その他",
    };

    const selectedReason = reasonMap[String(input).trim()];

    if (!selectedReason) {
      window.alert("1～6の番号を入力してください。");
      return;
    }

    let holdReason = selectedReason;

    if (selectedReason === "その他") {
      const customReason = window.prompt("保留理由を入力してください。");

      if (customReason === null) {
        return;
      }

      if (customReason.trim() === "") {
        window.alert("保留理由を入力してください。");
        return;
      }

      holdReason = customReason.trim();
    }

    setShippingData((previousData) =>
      previousData.map((item) => {
        if (
          String(item.shippingDataId) !==
          String(currentItem.shippingDataId)
        ) {
          return item;
        }

        return {
          ...item,
          status: STATUS.HOLD,
          holdReason,
          holdAt: new Date().toISOString(),
          completedAt: "",
          isExported: false,
          exportedAt: "",
        };
      })
    );

    if (currentIndex < pickingData.length - 1) {
      setCurrentIndex((previousIndex) => previousIndex + 1);
    }
  };

  const undoStatus = (shippingDataId) => {
    setShippingData((previousData) =>
      previousData.map((item) => {
        if (String(item.shippingDataId) !== String(shippingDataId)) {
          return item;
        }

        return {
          ...item,
          status: STATUS.PENDING,
          completedAt: "",
          holdAt: "",
          holdReason: "",
          isExported: false,
          exportedAt: "",
        };
      })
    );
  };

  const movePrevious = () => {
    setCurrentIndex((previousIndex) => Math.max(previousIndex - 1, 0));
  };

  const moveNext = () => {
    setCurrentIndex((previousIndex) =>
      Math.min(previousIndex + 1, activePickingCount - 1)
    );
  };

  const startPickingWork = () => {
    if (selectedWorkData.length === 0) {
      window.alert("選択した条件に該当する作業がありません。");
      return;
    }

    const targetIds = selectedWorkData.map((item) =>
      String(item.shippingDataId)
    );

    setWorkTargetIds(targetIds);
    setCurrentIndex(0);
    setWorkStarted(true);
    setActiveTab("picking");
  };

  const changeWorkConditions = () => {
    setWorkStarted(false);
    setWorkTargetIds([]);
    setCurrentIndex(0);
    setActiveTab("workSelect");
  };

  const resetWorkConditions = () => {
    setWorkDeliveryDate("すべて");
    setWorkDestination("すべて");
    setWorkLane("すべて");
    setWorkBoxType("すべて");
    setWorkBoxJudgement("全部");
    setWorkStatus("未作業・保留");
  };

  const clearAllData = async () => {
    const approved = window.confirm(
      [
        "取り込んだデータと作業進捗をすべて削除します。",
        "",
        "この操作は元に戻せません。",
        "よろしいですか？",
      ].join("\n")
    );

    if (!approved) {
      return;
    }

    try {
      await clearShippingData();
      localStorage.removeItem(STORAGE_KEY);

      setShippingData([]);
      setCurrentIndex(0);
      setWorkStarted(false);
      setWorkTargetIds([]);
      setFileName("");
      setImportMessage("");
      setStatusFilter("すべて");
      setSearchText("");

      window.alert("全データを削除しました。");
    } catch (error) {
      console.error("全データ削除に失敗しました。", error);
      window.alert("データの削除に失敗しました。");
    }
  };

  const exportBackup = () => {
    if (shippingData.length === 0) {
      window.alert("バックアップするデータがありません。");
      return;
    }

    const backupData = {
      systemName: "shipping-picking-system",
      version: 1,
      exportedAt: new Date().toISOString(),
      shippingData,
    };

    const jsonText = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonText], {
      type: "application/json;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `出荷ピッキング_バックアップ_${formatFileDate(
      new Date()
    )}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.alert(
      `${shippingData.length.toLocaleString()}件のバックアップを保存しました。`
    );
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const jsonText = await file.text();
      const backupData = JSON.parse(jsonText);

      if (
        backupData.systemName !== "shipping-picking-system" ||
        !Array.isArray(backupData.shippingData)
      ) {
        throw new Error(
          "このシステムのバックアップファイルではありません。"
        );
      }

      const approved = window.confirm(
        [
          `バックアップ件数：${backupData.shippingData.length.toLocaleString()}件`,
          `バックアップ日時：${formatDateTime(
            backupData.exportedAt
          )}`,
          "",
          "現在のデータをすべて置き換えて復元します。",
          "よろしいですか？",
        ].join("\n")
      );

      if (!approved) {
        return;
      }

      await saveShippingData(backupData.shippingData);

      setShippingData(backupData.shippingData);
      setCurrentIndex(0);
      setWorkStarted(false);
      setWorkTargetIds([]);
      setStatusFilter("すべて");
      setSearchText("");
      setShowAllDatesInList(false);

      window.alert(
        `${backupData.shippingData.length.toLocaleString()}件を復元しました。`
      );
    } catch (error) {
      console.error("バックアップ復元に失敗しました。", error);
      window.alert(
        `バックアップ復元に失敗しました。\n${error.message}`
      );
    }
  };

  const exportWorkListExcel = () => {
    const baseData = showAllDatesInList
      ? [...shippingData]
      : shippingData.filter(
          (item) => item.shippingDate === workShippingDate
        );

    const completedData = baseData.filter(
      (item) =>
        item.status === STATUS.COMPLETED &&
        item.isExported !== true
    );

    if (completedData.length === 0) {
      window.alert("未出力の完了済み作業実績がありません。");
      return;
    }

    const detailRows = completedData.map((item) => ({
      作業日: formatWorkDate(item.completedAt),
      出荷予定日: item.shippingPlannedDate || "",
      納期: item.deliveryDate || "",
      納入先: item.destinationName || "",
      品番: item.partNumber || "",
      数量: toNumber(item.quantity),
      注文No: item.orderNumber || "",
      検収番号: item.inspectionNumber || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(detailRows);

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 38 },
      { wch: 22 },
      { wch: 14 },
      { wch: 18 },
      { wch: 20 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "作業実績");

    const dateText = showAllDatesInList
      ? "全出荷日"
      : String(workShippingDate).replaceAll("/", "");

    const now = new Date();

    const outputFileName = `作業実績_${dateText}_${formatFileDate(
      now
    )}.xlsx`;

    XLSX.writeFile(workbook, outputFileName);

    const exportedIds = new Set(
      completedData.map((item) =>
        String(item.shippingDataId)
      )
    );

    setShippingData((previousData) =>
      previousData.map((item) => {
        if (!exportedIds.has(String(item.shippingDataId))) {
          return item;
        }

        return {
          ...item,
          isExported: true,
          exportedAt: now.toISOString(),
        };
      })
    );

    window.alert(
      `${completedData.length.toLocaleString()}件の作業実績を出力しました。`
    );
  };

  const confirmComplete = (item) => {
    const approved = window.confirm(
      [
        `品番：${item.partNumber || "-"}`,
        `ロケ：${item.lane || "-"}`,
        `箱数：${toNumber(item.totalBoxes).toLocaleString()}箱`,
        `数量：${toNumber(item.quantity).toLocaleString()}個`,
        "",
        "この作業を完了しますか？",
      ].join("\n")
    );

    if (!approved) {
      return;
    }

    updateStatus(item.shippingDataId, STATUS.COMPLETED);
  };

  const confirmUndo = (item, message) => {
    const approved = window.confirm(
      [
        `品番：${item.partNumber || "-"}`,
        `ロケ：${item.lane || "-"}`,
        `箱数：${toNumber(item.totalBoxes).toLocaleString()}箱`,
        `数量：${toNumber(item.quantity).toLocaleString()}個`,
        "",
        message,
      ].join("\n")
    );

    if (!approved) {
      return;
    }

    undoStatus(item.shippingDataId);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>出荷ピッキングシステム</h1>
          <p>Androidタブレット対応</p>
        </div>
      </header>

      <nav className="tab-navigation">
        <button
          className={activeTab === "import" ? "active" : ""}
          onClick={() => setActiveTab("import")}
        >
          データ取込
        </button>

        <button
          className={activeTab === "workSelect" ? "active" : ""}
          onClick={() => setActiveTab("workSelect")}
        >
          作業対象選択
        </button>

        <button
          className={activeTab === "picking" ? "active" : ""}
          onClick={() => setActiveTab("picking")}
        >
          ピッキング
        </button>

        <button
          className={activeTab === "list" ? "active" : ""}
          onClick={() => setActiveTab("list")}
        >
          作業一覧
        </button>
      </nav>

      <main className="main-content">
        {activeTab === "import" && (
          <section className="page-section">
            <div className="section-title-row">
              <div>
                <h2>出荷データ取込</h2>
                <p>ExcelまたはCSVを取り込みます。</p>
              </div>
            </div>

            <div className="import-card">
              <label className="file-select-button">
                Excel／CSVを選択
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                />
              </label>

              <div className="file-information">
                <span>選択ファイル</span>
                <strong>{fileName || "未選択"}</strong>
              </div>

              {importMessage && (
                <div
                  className={
                    importMessage.startsWith("取込エラー")
                      ? "message error-message"
                      : "message success-message"
                  }
                >
                  {importMessage}
                </div>
              )}
            </div>

            <div className="information-card">
              <h3>取込に使用する列</h3>

              <div className="column-grid">
                <span>出荷データID</span>
                <span>注文番号</span>
                <span>矢崎品番</span>
                <span>発注数</span>
                <span>納入場所名</span>
                <span>納期</span>
                <span>レーン</span>
                <span>収容数【荷主側】</span>
                <span>収容数【出荷時】</span>
                <span>箱種</span>
              </div>
            </div>

            <div className="button-row backup-button-row">
              <button
                type="button"
                className="backup-export-button"
                onClick={exportBackup}
                disabled={shippingData.length === 0}
              >
                バックアップ保存
              </button>

              <label className="backup-import-button">
                バックアップ復元
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={importBackup}
                />
              </label>

              <button
                type="button"
                className="danger-button"
                onClick={clearAllData}
                disabled={shippingData.length === 0}
              >
                全データ削除
              </button>
            </div>
          </section>
        )}

        {activeTab === "workSelect" && (
          <section className="page-section">
            <div className="section-title-row">
              <div>
                <h2>作業対象選択</h2>
                <p>
                  ピッキングする出荷日・納期・納入先・ロケ・箱種を選択してください。
                </p>
              </div>
            </div>

            {shippingData.length === 0 ? (
              <div className="empty-card">
                <h2>出荷データがありません</h2>
                <p>
                  データ取込画面からExcelまたはCSVを取り込んでください。
                </p>
              </div>
            ) : (
              <>
                <div className="work-filter-grid">
                  <label>
                    <span>出荷日</span>
                    <select
                      value={workShippingDate}
                      onChange={(event) => {
                        setWorkShippingDate(event.target.value);
                        setWorkDeliveryDate("すべて");
                        setWorkDestination("すべて");
                        setWorkLane("すべて");
                        setWorkBoxType("すべて");
                      }}
                    >
                      {shippingDateOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>納期</span>
                    <select
                      value={workDeliveryDate}
                      onChange={(event) => {
                        setWorkDeliveryDate(event.target.value);
                        setWorkDestination("すべて");
                        setWorkLane("すべて");
                        setWorkBoxType("すべて");
                      }}
                    >
                      <option>すべて</option>

                      {deliveryDateOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>納入先</span>
                    <select
                      value={workDestination}
                      onChange={(event) => {
                        setWorkDestination(event.target.value);
                        setWorkLane("すべて");
                        setWorkBoxType("すべて");
                      }}
                    >
                      <option>すべて</option>

                      {destinationOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>ロケ</span>
                    <select
                      value={workLane}
                      onChange={(event) => {
                        setWorkLane(event.target.value);
                        setWorkBoxType("すべて");
                      }}
                    >
                      <option>すべて</option>

                      {laneOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>箱種</span>
                    <select
                      value={workBoxType}
                      onChange={(event) =>
                        setWorkBoxType(event.target.value)
                      }
                    >
                      <option>すべて</option>

                      {boxTypeOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>箱区分</span>
                    <select
                      value={workBoxJudgement}
                      onChange={(event) =>
                        setWorkBoxJudgement(event.target.value)
                      }
                    >
                      <option value="全部">全部</option>
                      <option value="端数のみ">端数のみ</option>
                      <option value="整数のみ">整数のみ</option>
                    </select>
                  </label>

                  <label>
                    <span>作業モード</span>
                    <select
                      value={pickingMode}
                      onChange={(event) => {
                        setPickingMode(event.target.value);
                        setCurrentIndex(0);
                      }}
                    >
                      <option value={PICKING_MODE.DETAIL}>
                        明細ピッキング
                      </option>
                      <option value={PICKING_MODE.AGGREGATE}>
                        品番集計ピッキング
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>作業状態</span>
                    <select
                      value={workStatus}
                      onChange={(event) =>
                        setWorkStatus(event.target.value)
                      }
                    >
                      <option>未作業・保留</option>
                      <option>未作業のみ</option>
                      <option>保留のみ</option>
                    </select>
                  </label>
                </div>

                <div className="work-selection-summary">
                  <div>
                    <span>対象件数</span>
                    <strong>
                      {selectedWorkCount.toLocaleString()}
                      <small>件</small>
                    </strong>
                  </div>

                  <div>
                    <span>対象品番</span>
                    <strong>
                      {selectedWorkPartCount.toLocaleString()}
                      <small>品番</small>
                    </strong>
                  </div>

                  <div>
                    <span>対象箱数</span>
                    <strong>
                      {selectedWorkBoxes.toLocaleString()}
                      <small>箱</small>
                    </strong>
                  </div>

                  <div>
                    <span>対象数量</span>
                    <strong>
                      {selectedWorkQuantity.toLocaleString()}
                      <small>個</small>
                    </strong>
                  </div>
                </div>

                <div className="selected-condition-card">
                  <h3>選択中の条件</h3>

                  <div className="selected-condition-list">
                    <span>出荷日：{workShippingDate}</span>
                    <span>納期：{workDeliveryDate}</span>
                    <span>納入先：{workDestination}</span>
                    <span>ロケ：{workLane}</span>
                    <span>箱種：{workBoxType}</span>
                    <span>箱区分：{workBoxJudgement}</span>
                    <span>
                      作業モード：
                      {pickingMode === PICKING_MODE.AGGREGATE
                        ? "品番集計ピッキング"
                        : "明細ピッキング"}
                    </span>
                    <span>状態：{workStatus}</span>
                  </div>
                </div>

                <div className="work-select-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={resetWorkConditions}
                  >
                    条件をリセット
                  </button>

                  <button
                    type="button"
                    className="start-work-button"
                    onClick={startPickingWork}
                    disabled={selectedWorkCount === 0}
                  >
                    この条件でピッキング開始
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === "picking" && (
          <section className="page-section">
            {workStarted && (
              <div className="compact-work-summary">
                <div className="work-date-summary">
                  <span>作業対象出荷日</span>
                  <strong>{workShippingDate}</strong>
                </div>

                <div>
                  <span>作業進捗</span>
                  <strong>{workProgress}%</strong>
                </div>

                <div>
                  <span>完了件数</span>
                  <strong>
                    {workCompletedCount.toLocaleString()}／
                    {workTotalCount.toLocaleString()}件
                  </strong>
                </div>

                <div>
                  <span>完了箱数</span>
                  <strong>
                    {workCompletedBoxes.toLocaleString()}／
                    {workTotalBoxes.toLocaleString()}箱
                  </strong>
                </div>

                <div>
                  <span>残り件数</span>
                  <strong>
                    {workRemainingCount.toLocaleString()}件
                  </strong>
                </div>

                <div>
                  <span>残り品番</span>
                  <strong>
                    {workRemainingPartCount.toLocaleString()}品番
                  </strong>
                </div>
              </div>
            )}

            <div className="picking-toolbar">
              <button
                type="button"
                className="change-condition-button"
                onClick={changeWorkConditions}
              >
                作業条件を変更
              </button>

              <label>
                作業モード
                <select
                  value={pickingMode}
                  onChange={(event) => {
                    setPickingMode(event.target.value);
                    setCurrentIndex(0);
                  }}
                >
                  <option value={PICKING_MODE.DETAIL}>
                    明細ピッキング
                  </option>
                  <option value={PICKING_MODE.AGGREGATE}>
                    品番集計ピッキング
                  </option>
                </select>
              </label>
            </div>

            <SortSettings
              sortRules={sortRules}
              boxTypeOrder={boxTypeOrder}
              onUpdateRule={updateSortRule}
              onChangeBoxTypeOrder={updateBoxTypeOrder}
              onReset={resetSortSettings}
            />

            {!workStarted ? (
              <div className="empty-card">
                <h2>作業対象が選択されていません</h2>
                <p>
                  作業対象選択画面で条件を選び、ピッキングを開始してください。
                </p>

                <button
                  type="button"
                  className="start-work-button compact-start-button"
                  onClick={() => setActiveTab("workSelect")}
                >
                  作業対象を選択
                </button>
              </div>
            ) : activePickingCount === 0 ? (
              <div className="empty-card">
                <h2>選択した作業はすべて完了しました</h2>
                <p>
                  作業一覧で完了状態を確認するか、条件を変更してください。
                </p>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={changeWorkConditions}
                >
                  作業条件を変更
                </button>
              </div>
            ) : pickingMode === PICKING_MODE.AGGREGATE ? (
              <div className="picking-card">
                <div className="picking-position">
                  品番集計 {currentIndex + 1}／
                  {aggregatePickingData.length}品番
                </div>

                <div className="primary-information">
                  <div className="lane-box">
                    <span>対象ロケ</span>
                    <strong>
                      {currentAggregate?.lanes.join("・") || "未設定"}
                    </strong>
                    <small>
                      箱種：
                      {currentAggregate?.boxTypes.join("・") || "未設定"}
                    </small>
                  </div>

                  <div className="part-number-box">
                    <span>品番</span>
                    <strong>
                      {currentAggregate?.partNumber || "-"}
                    </strong>
                  </div>
                </div>

                <div className="quantity-grid">
                  <div>
                    <span>合計箱数</span>

                    <strong>
                      {toNumber(
                        currentAggregate?.totalBoxes
                      ).toLocaleString()}
                      <small>箱</small>
                    </strong>

                    <div className="box-breakdown">
                      <div className="full-box-display">
                        <span>整数箱</span>
                        <strong>
                          {toNumber(
                            currentAggregate?.fullBoxes
                          ).toLocaleString()}
                          箱
                        </strong>
                      </div>

                      <div
                        className={
                          toNumber(currentAggregate?.partialBoxes) > 0
                            ? "partial-box-display has-partial"
                            : "partial-box-display"
                        }
                      >
                        <span>端数箱</span>
                        <strong>
                          {toNumber(
                            currentAggregate?.partialBoxes
                          ).toLocaleString()}
                          箱
                        </strong>
                      </div>
                    </div>

                    {currentAggregate?.partialBreakdowns.length > 0 && (
                      <div className="capacity-breakdown">
                        {currentAggregate.partialBreakdowns.map(
                          (breakdown) => (
                            <div
                              className="partial-quantity-row"
                              key={breakdown.key}
                            >
                              <span>
                                {breakdown.boxType || "箱種未設定"}
                              </span>
                              <strong>
                                {breakdown.quantityPerBox.toLocaleString()}
                                個 ×{" "}
                                {breakdown.boxes.toLocaleString()}
                                箱
                              </strong>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <span>合計数量</span>

                    <strong>
                      {toNumber(
                        currentAggregate?.quantity
                      ).toLocaleString()}
                      <small>個</small>
                    </strong>

                    <p>
                      対象明細{" "}
                      <strong>
                        {toNumber(
                          currentAggregate?.detailCount
                        ).toLocaleString()}
                        件
                      </strong>
                    </p>

                    <p>
                      納入先{" "}
                      <strong>
                        {toNumber(
                          currentAggregate?.destinationCount
                        ).toLocaleString()}
                        か所
                      </strong>
                    </p>

                    <p>
                      端数内訳{" "}
                      <strong>
                        {toNumber(
                          currentAggregate?.partialBreakdowns.length
                        ).toLocaleString()}
                        種類
                      </strong>
                    </p>
                  </div>
                </div>

                <div className="detail-grid">
                  <DetailItem
                    label="対象ロケ"
                    value={currentAggregate?.lanes.join("・")}
                    wide
                  />

                  <DetailItem
                    label="箱種"
                    value={currentAggregate?.boxTypes.join("・")}
                  />

                  <DetailItem
                    label="納入先数"
                    value={`${toNumber(
                      currentAggregate?.destinationCount
                    ).toLocaleString()}か所`}
                  />

                  <DetailItem
                    label="対象明細"
                    value={`${toNumber(
                      currentAggregate?.detailCount
                    ).toLocaleString()}件`}
                  />
                </div>

                <details className="sort-settings-panel">
                  <summary>
                    明細内訳を確認（
                    {toNumber(
                      currentAggregate?.detailCount
                    ).toLocaleString()}
                    件）
                  </summary>

                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>納入先</th>
                          <th>ロケ</th>
                          <th>箱種</th>
                          <th>数量</th>
                          <th>箱数</th>
                          <th>注文No.</th>
                          <th>検収番号</th>
                          <th>状態</th>
                        </tr>
                      </thead>

                      <tbody>
                        {currentAggregate?.items.map((item) => (
                          <tr key={item.shippingDataId}>
                            <td>{item.destinationName || "-"}</td>
                            <td className="large-table-text">
                              {item.lane || "-"}
                            </td>
                            <td>{item.boxType || "-"}</td>
                            <td>
                              {toNumber(
                                item.quantity
                              ).toLocaleString()}
                              個
                            </td>
                            <td>
                              {toNumber(
                                item.totalBoxes
                              ).toLocaleString()}
                              箱
                            </td>
                            <td>{item.orderNumber || "-"}</td>
                            <td>{item.inspectionNumber || "-"}</td>
                            <td>
                              <span
                                className={`status-badge ${statusClassName(
                                  item.status
                                )}`}
                              >
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>

                <div className="picking-actions">
                  <button
                    className="navigation-button"
                    onClick={movePrevious}
                    disabled={currentIndex === 0}
                  >
                    前へ
                  </button>

                  <button
                    className="hold-button"
                    onClick={holdCurrentAggregate}
                  >
                    品番を保留
                  </button>

                  <button
                    className="complete-button"
                    onClick={completeCurrentAggregate}
                  >
                    トータルピッキング完了
                  </button>

                  <button
                    className="navigation-button"
                    onClick={moveNext}
                    disabled={
                      currentIndex >= aggregatePickingData.length - 1
                    }
                  >
                    次へ
                  </button>
                </div>
              </div>
            ) : (
              <div className="picking-card">
                <div className="picking-position">
                  作業 {workCompletedCount + 1}／
                  {workTotalCount}件
                </div>

                {currentItem.status === STATUS.HOLD && (
                  <div className="hold-banner">
                    保留中：
                    {currentItem.holdReason || "理由未登録"}
                  </div>
                )}

                <div className="primary-information">
                  <div className="lane-box">
                    <span>ロケ</span>
                    <strong>{currentItem.lane || "未設定"}</strong>
                    <small>箱種：{currentItem.boxType || "未設定"}</small>
                  </div>

                  <div className="part-number-box">
                    <span>品番</span>
                    <strong>
                      {currentItem.partNumber || "-"}
                    </strong>
                  </div>
                </div>

                <div className="quantity-grid">
                  <div>
                    <span>箱数</span>

                    <strong>
                      {toNumber(
                        currentItem.totalBoxes
                      ).toLocaleString()}
                      <small>箱</small>
                    </strong>

                    <div className="box-breakdown">
                      <div className="full-box-display">
                        <span>整数箱</span>
                        <strong>
                          {toNumber(
                            currentItem.fullBoxes
                          ).toLocaleString()}
                          箱
                        </strong>
                      </div>

                      <div
                        className={
                          toNumber(currentItem.partialBoxes) > 0
                            ? "partial-box-display has-partial"
                            : "partial-box-display"
                        }
                      >
                        <span>端数箱</span>
                        <strong>
                          {toNumber(
                            currentItem.partialBoxes
                          ).toLocaleString()}
                          箱
                        </strong>
                      </div>
                    </div>

                    <div className="capacity-breakdown">
                      {toNumber(currentItem.fullBoxes) > 0 && (
                        <div>
                          <span>整数</span>
                          <strong>
                            {toNumber(
                              currentItem.capacity
                            ).toLocaleString()}
                            個 ×{" "}
                            {toNumber(
                              currentItem.fullBoxes
                            ).toLocaleString()}
                            箱
                          </strong>
                        </div>
                      )}

                      {toNumber(currentItem.partialBoxes) > 0 && (
                        <div className="partial-quantity-row">
                          <span>端数</span>
                          <strong>
                            {getPartialQuantityPerBox(
                              currentItem
                            ).toLocaleString()}
                            個 ×{" "}
                            {toNumber(
                              currentItem.partialBoxes
                            ).toLocaleString()}
                            箱
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <span>数量</span>

                    <strong>
                      {toNumber(
                        currentItem.quantity
                      ).toLocaleString()}
                      <small>個</small>
                    </strong>

                    <p>
                      荷主収容数{" "}
                      {toNumber(
                        currentItem.ownerCapacity
                      ).toLocaleString()}
                      個／箱
                    </p>

                    <p>
                      出荷時収容数{" "}
                      {toNumber(
                        currentItem.capacity
                      ).toLocaleString()}
                      個／箱
                    </p>

                    <p>
                      判定{" "}
                      <strong>
                        {currentItem.boxJudgement || "従来判定"}
                      </strong>
                    </p>
                  </div>
                </div>

                <div className="detail-grid">
                  <DetailItem
                    label="納入先"
                    value={currentItem.destinationName}
                    wide
                  />

                  <DetailItem
                    label="納入先コード"
                    value={currentItem.destinationCode}
                  />

                  <DetailItem
                    label="注文No."
                    value={currentItem.orderNumber}
                  />

                  <DetailItem
                    label="納期"
                    value={currentItem.deliveryDate}
                  />

                  <DetailItem
                    label="出荷日"
                    value={currentItem.shippingDate}
                  />

                  <DetailItem
                    label="検収番号"
                    value={currentItem.inspectionNumber}
                  />

                  <DetailItem
                    label="箱種"
                    value={currentItem.boxType}
                  />
                </div>

                <div className="picking-actions">
                  <button
                    className="navigation-button"
                    onClick={movePrevious}
                    disabled={currentIndex === 0}
                  >
                    前へ
                  </button>

                  <button
                    className="hold-button"
                    onClick={holdCurrentItem}
                  >
                    保留
                  </button>

                  <button
                    className="complete-button"
                    onClick={completeCurrentItem}
                  >
                    この作業を完了
                  </button>

                  <button
                    className="navigation-button"
                    onClick={moveNext}
                    disabled={
                      currentIndex >= pickingData.length - 1
                    }
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}

          </section>
        )}

        {activeTab === "list" && (
          <section className="page-section">
            <div className="section-title-row">
              <div>
                <h2>作業一覧</h2>

                <p>
                  {showAllDatesInList
                    ? `全出荷日：${filteredData.length.toLocaleString()}件を表示中`
                    : `出荷日 ${
                        workShippingDate || "未選択"
                      }：${filteredData.length.toLocaleString()}件を表示中`}
                </p>
              </div>

              <div className="list-header-actions">
                <button
                  type="button"
                  className="excel-export-button"
                  onClick={exportWorkListExcel}
                >
                  Excel出力
                </button>

                <button
                  type="button"
                  className={
                    statusFilter === STATUS.HOLD
                      ? "hold-count-button active"
                      : "hold-count-button"
                  }
                  onClick={() => {
                    setStatusFilter((previousStatus) =>
                      previousStatus === STATUS.HOLD
                        ? "すべて"
                        : STATUS.HOLD
                    );
                  }}
                >
                  保留：{listHoldCount.toLocaleString()}件
                </button>

                <button
                  type="button"
                  className="date-display-toggle"
                  onClick={() =>
                    setShowAllDatesInList(
                      (previousValue) => !previousValue
                    )
                  }
                >
                  {showAllDatesInList
                    ? "選択中の出荷日だけ表示"
                    : "全出荷日を表示"}
                </button>
              </div>
            </div>

            <div className="list-controls">
              <input
                type="search"
                value={searchText}
                onChange={(event) =>
                  setSearchText(event.target.value)
                }
                placeholder="品番・注文No.・納入先・ロケ・箱種で検索"
              />

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value)
                }
              >
                <option>すべて</option>
                <option>{STATUS.PENDING}</option>
                <option>{STATUS.COMPLETED}</option>
                <option>{STATUS.HOLD}</option>
              </select>

              <select
                value={listBoxJudgement}
                onChange={(event) =>
                  setListBoxJudgement(event.target.value)
                }
                aria-label="箱区分"
              >
                <option value="全部">全部</option>
                <option value="端数のみ">端数のみ</option>
                <option value="整数のみ">整数のみ</option>
              </select>

            </div>

            <SortSettings
              sortRules={sortRules}
              boxTypeOrder={boxTypeOrder}
              onUpdateRule={updateSortRule}
              onChangeBoxTypeOrder={updateBoxTypeOrder}
              onReset={resetSortSettings}
            />

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>状態</th>
                    <th>ロケ</th>
                    <th>箱種</th>
                    <th>品番</th>
                    <th>箱数</th>
                    <th>数量</th>
                    <th>納入先</th>
                    <th>出荷日</th>
                    <th>納期</th>
                    <th>注文No.</th>
                    <th>保留理由</th>
                    <th>出力</th>
                    <th>操作</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredData.map((item) => (
                    <tr
                      key={item.shippingDataId}
                      className={`status-${statusClassName(
                        item.status
                      )}`}
                    >
                      <td>
                        <span
                          className={`status-badge status-${statusClassName(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>

                      <td className="large-table-text">
                        {item.lane || "-"}
                      </td>

                      <td>
                        {item.boxType || "-"}
                      </td>

                      <td className="large-table-text">
                        {item.partNumber}
                      </td>

                      <td>
                        <div className="list-box-count">
                          <strong>
                            合計{" "}
                            {toNumber(
                              item.totalBoxes
                            ).toLocaleString()}
                            箱
                          </strong>

                          <span>
                            整数{" "}
                            {toNumber(
                              item.fullBoxes
                            ).toLocaleString()}
                            箱
                          </span>

                          <span
                            className={
                              toNumber(item.partialBoxes) > 0
                                ? "list-partial-box has-partial"
                                : "list-partial-box"
                            }
                          >
                            端数{" "}
                            {toNumber(
                              item.partialBoxes
                            ).toLocaleString()}
                            箱
                          </span>
                        </div>
                      </td>

                      <td>
                        {toNumber(item.quantity).toLocaleString()}
                        個
                      </td>

                      <td>{item.destinationName}</td>
                      <td>{item.shippingDate}</td>
                      <td>{item.deliveryDate}</td>
                      <td>{item.orderNumber}</td>

                      <td>
                        {item.status === STATUS.HOLD
                          ? item.holdReason || "理由未登録"
                          : "-"}
                      </td>

                      <td>
                        {item.status === STATUS.COMPLETED
                          ? item.isExported
                            ? "出力済"
                            : "未出力"
                          : "-"}
                      </td>

                      <td>
                        {item.status === STATUS.COMPLETED ? (
                          <button
                            className="small-button"
                            onClick={() =>
                              confirmUndo(
                                item,
                                "この完了データを未作業に戻しますか？"
                              )
                            }
                          >
                            未作業に戻す
                          </button>
                        ) : item.status === STATUS.HOLD ? (
                          <div className="hold-action-buttons">
                            <button
                              className="small-complete-button"
                              onClick={() => {
                                const approved = window.confirm(
                                  [
                                    `品番：${item.partNumber || "-"}`,
                                    `ロケ：${item.lane || "-"}`,
                                    `箱数：${toNumber(
                                      item.totalBoxes
                                    ).toLocaleString()}箱`,
                                    `数量：${toNumber(
                                      item.quantity
                                    ).toLocaleString()}個`,
                                    `保留理由：${
                                      item.holdReason ||
                                      "理由未登録"
                                    }`,
                                    "",
                                    "この保留データを完了にしますか？",
                                  ].join("\n")
                                );

                                if (!approved) {
                                  return;
                                }

                                updateStatus(
                                  item.shippingDataId,
                                  STATUS.COMPLETED
                                );
                              }}
                            >
                              完了
                            </button>

                            <button
                              className="small-button"
                              onClick={() =>
                                confirmUndo(
                                  item,
                                  "この保留データを未作業に戻しますか？"
                                )
                              }
                            >
                              未作業に戻す
                            </button>
                          </div>
                        ) : (
                          <button
                            className="small-complete-button"
                            onClick={() => confirmComplete(item)}
                          >
                            完了
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {filteredData.length === 0 && (
                    <tr>
                      <td
                        colSpan="13"
                        className="empty-table-cell"
                      >
                        該当するデータがありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function SortSettings({
  sortRules,
  boxTypeOrder,
  onUpdateRule,
  onChangeBoxTypeOrder,
  onReset,
}) {
  return (
    <details className="sort-settings-panel">
      <summary>並び順設定</summary>

      <div className="sort-rule-list">
        {sortRules.map((rule, index) => (
          <div
            className="sort-rule-row"
            key={`${index}-${rule.field}`}
          >
            <strong>第{index + 1}優先</strong>

            <select
              value={rule.field}
              onChange={(event) =>
                onUpdateRule(index, "field", event.target.value)
              }
            >
              {SORT_FIELD_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={rule.direction}
              onChange={(event) =>
                onUpdateRule(
                  index,
                  "direction",
                  event.target.value
                )
              }
            >
              {rule.field === "boxType" && (
                <option value="custom">指定順</option>
              )}

              {rule.field === "totalBoxes" ? (
                <>
                  <option value="desc">多い順</option>
                  <option value="asc">少ない順</option>
                </>
              ) : rule.field === "importOrder" ? (
                <>
                  <option value="asc">取込順</option>
                  <option value="desc">逆順</option>
                </>
              ) : (
                <>
                  <option value="asc">昇順</option>
                  <option value="desc">降順</option>
                </>
              )}
            </select>
          </div>
        ))}
      </div>

      {sortRules.some(
        (rule) =>
          rule.field === "boxType" &&
          rule.direction === "custom"
      ) && (
        <div className="box-type-order-panel">
          <h4>箱種の指定順</h4>

          {boxTypeOrder.length === 0 ? (
            <p>箱種データがありません。</p>
          ) : (
            <div className="box-type-order-list">
              {boxTypeOrder.map((boxType, index) => (
                <label
                  className="box-type-order-row"
                  key={`box-type-rank-${index}`}
                >
                  <strong>{index + 1}番目</strong>

                  <select
                    value={boxType}
                    onChange={(event) =>
                      onChangeBoxTypeOrder(
                        index,
                        event.target.value
                      )
                    }
                  >
                    {boxTypeOrder.map((option) => (
                      <option
                        key={option}
                        value={option}
                      >
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="secondary-button sort-reset-button"
        onClick={onReset}
      >
        並び順を初期設定に戻す
      </button>
    </details>
  );
}

function DetailItem({ label, value, wide = false }) {
  return (
    <div className={wide ? "detail-item detail-wide" : "detail-item"}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => {
    const values = row.map((value) => String(value).trim());

    return (
      values.includes("矢崎品番") &&
      values.includes("発注数") &&
      values.includes("注文番号")
    );
  });
}

function convertRowToShippingData(row, headers, rowIndex) {
  const getValue = (headerName) => {
    const columnIndex = headers.indexOf(headerName);

    if (columnIndex === -1) {
      return "";
    }

    return row[columnIndex] ?? "";
  };

  const partNumber = cleanValue(getValue("矢崎品番"));
  const orderNumber = cleanValue(getValue("注文番号"));
  const quantity = toNumber(getValue("発注数"));
  const destinationName = cleanValue(getValue("納入場所名"));

  if (!partNumber && !orderNumber && quantity === 0 && !destinationName) {
    return null;
  }

  const ownerCapacity = toNumber(getValue("収容数【荷主側】"));
  const shippingCapacity = toNumber(getValue("収容数【出荷時】"));
  const sourceFullBoxes = toNumber(getValue("箱整数【出荷時】"));
  const sourcePartialBoxes = toNumber(getValue("箱端数【出荷時】"));
  const sourceTotalBoxes = sourceFullBoxes + sourcePartialBoxes;

  const totalBoxes =
    sourceTotalBoxes > 0
      ? sourceTotalBoxes
      : shippingCapacity > 0
      ? Math.ceil(quantity / shippingCapacity)
      : 0;

  let fullBoxes = sourceFullBoxes;
  let partialBoxes = sourcePartialBoxes;
  let boxJudgement = "従来判定";

  if (ownerCapacity > 0 && shippingCapacity > 0) {
    if (shippingCapacity < ownerCapacity) {
      fullBoxes = 0;
      partialBoxes = totalBoxes;
      boxJudgement = "端数";
    } else {
      fullBoxes = totalBoxes;
      partialBoxes = 0;
      boxJudgement = "整数";
    }
  }

  const sourceShippingDataId = cleanValue(
    getValue("出荷データID")
  );

  const fallbackId = [
    orderNumber,
    partNumber,
    cleanValue(getValue("納期")),
    cleanValue(getValue("納入先コード")),
    rowIndex,
  ].join("-");

  return {
    shippingDataId: sourceShippingDataId || fallbackId,
    orderNumber,
    partNumber,
    quantity,
    destinationCode: cleanValue(getValue("納入先コード")),
    destinationName,
    deliveryDate: formatExcelDate(getValue("納期")),
    shippingPlannedDate: formatExcelDate(
      getValue("出荷予定日")
    ),
    shippingDate: formatExcelDate(getValue("出荷日")),
    lane: cleanValue(getValue("レーン")),
    boxType: cleanValue(getValue("箱種")),
    inspectionNumber: cleanValue(getValue("検収番号")),
    ownerCapacity,
    capacity: shippingCapacity,
    fullBoxes,
    partialBoxes,
    totalBoxes,
    boxJudgement,
    orderCategory: cleanValue(getValue("受注区分表示")),
    supplierPartNumber: cleanValue(getValue("業者品番")),
    status: STATUS.PENDING,
    completedAt: "",
    holdAt: "",
    holdReason: "",
    exportedAt: "",
    isExported: false,
    importOrder: rowIndex,
    importedAt: "",
    importFileName: "",
  };
}

function cleanValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const normalizedValue = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function createPartAggregates(items, boxTypeOrder = []) {
  const groupMap = new Map();

  items.forEach((item) => {
    const partNumber = item.partNumber || "品番未設定";

    if (!groupMap.has(partNumber)) {
      groupMap.set(partNumber, {
        partNumber,
        items: [],
        quantity: 0,
        totalBoxes: 0,
        fullBoxes: 0,
        partialBoxes: 0,
        lanes: [],
        boxTypes: [],
        destinations: [],
        detailCount: 0,
        destinationCount: 0,
        partialBreakdowns: [],
      });
    }

    const group = groupMap.get(partNumber);

    group.items.push(item);
    group.quantity += toNumber(item.quantity);
    group.totalBoxes += toNumber(item.totalBoxes);
    group.fullBoxes += toNumber(item.fullBoxes);
    group.partialBoxes += toNumber(item.partialBoxes);
  });

  return [...groupMap.values()].map((group) => {
    group.detailCount = group.items.length;

    group.lanes = createUniqueOptions(
      group.items.map((item) => item.lane)
    );

    group.destinations = createUniqueOptions(
      group.items.map((item) => item.destinationName)
    );
    group.destinationCount = group.destinations.length;

    const detectedBoxTypes = createUniqueOptions(
      group.items.map((item) => item.boxType)
    );

    group.boxTypes = [
      ...boxTypeOrder.filter((boxType) =>
        detectedBoxTypes.includes(boxType)
      ),
      ...detectedBoxTypes.filter(
        (boxType) => !boxTypeOrder.includes(boxType)
      ),
    ];

    const partialMap = new Map();

    group.items.forEach((item) => {
      const partialBoxes = toNumber(item.partialBoxes);

      if (partialBoxes <= 0) {
        return;
      }

      const quantityPerBox = getPartialQuantityPerBox(item);
      const boxType = item.boxType || "箱種未設定";
      const key = `${boxType}__${quantityPerBox}`;

      if (!partialMap.has(key)) {
        partialMap.set(key, {
          key,
          boxType,
          quantityPerBox,
          boxes: 0,
        });
      }

      partialMap.get(key).boxes += partialBoxes;
    });

    group.partialBreakdowns = [...partialMap.values()].sort((a, b) => {
      const aIndex = boxTypeOrder.indexOf(a.boxType);
      const bIndex = boxTypeOrder.indexOf(b.boxType);

      const normalizedA =
        aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const normalizedB =
        bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;

      if (normalizedA !== normalizedB) {
        return normalizedA - normalizedB;
      }

      if (a.boxType !== b.boxType) {
        return String(a.boxType).localeCompare(
          String(b.boxType),
          "ja",
          { numeric: true }
        );
      }

      return b.quantityPerBox - a.quantityPerBox;
    });

    return group;
  });
}

function compareBySortRule(
  a,
  b,
  rule,
  boxTypeOrder
) {
  const { field, direction } = rule;

  if (field === "boxType" && direction === "custom") {
    const aIndex = boxTypeOrder.indexOf(a.boxType);
    const bIndex = boxTypeOrder.indexOf(b.boxType);

    const normalizedA =
      aIndex === -1
        ? Number.MAX_SAFE_INTEGER
        : aIndex;

    const normalizedB =
      bIndex === -1
        ? Number.MAX_SAFE_INTEGER
        : bIndex;

    return normalizedA - normalizedB;
  }

  if (
    field === "totalBoxes" ||
    field === "importOrder"
  ) {
    const aValue = toNumber(a[field]);
    const bValue = toNumber(b[field]);

    return direction === "desc"
      ? bValue - aValue
      : aValue - bValue;
  }

  const aValue = String(a[field] ?? "");
  const bValue = String(b[field] ?? "");

  const compared = aValue.localeCompare(
    bValue,
    "ja",
    { numeric: true }
  );

  return direction === "desc"
    ? -compared
    : compared;
}

function getPartialQuantityPerBox(item) {
  const partialBoxes = toNumber(item.partialBoxes);
  const shippingCapacity = toNumber(item.capacity);
  const fullBoxes = toNumber(item.fullBoxes);
  const quantity = toNumber(item.quantity);

  if (partialBoxes <= 0) {
    return 0;
  }

  if (
    item.boxJudgement === "端数" &&
    shippingCapacity > 0
  ) {
    return shippingCapacity;
  }

  const remainingQuantity =
    quantity - shippingCapacity * fullBoxes;

  if (remainingQuantity > 0) {
    return Math.floor(
      remainingQuantity / partialBoxes
    );
  }

  return shippingCapacity;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function formatExcelDate(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateObject(value);
  }

  const stringValue = String(value).trim();

  const eightDigitDate = stringValue.match(
    /^(\d{4})(\d{2})(\d{2})$/
  );

  if (eightDigitDate) {
    return `${eightDigitDate[1]}/${eightDigitDate[2]}/${eightDigitDate[3]}`;
  }

  const slashDate = stringValue.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/
  );

  if (slashDate) {
    return `${slashDate[1]}/${String(
      slashDate[2]
    ).padStart(2, "0")}/${String(slashDate[3]).padStart(
      2,
      "0"
    )}`;
  }

  const numericValue = Number(stringValue);

  if (
    Number.isFinite(numericValue) &&
    numericValue > 20000 &&
    numericValue < 100000
  ) {
    const dateInfo = XLSX.SSF.parse_date_code(numericValue);

    if (dateInfo) {
      return `${dateInfo.y}/${String(dateInfo.m).padStart(
        2,
        "0"
      )}/${String(dateInfo.d).padStart(2, "0")}`;
    }
  }

  return stringValue;
}

function formatDateObject(date) {
  return `${date.getFullYear()}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}/${String(date.getDate()).padStart(
    2,
    "0"
  )}`;
}

function formatWorkDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatDateObject(date);
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${formatDateObject(date)} ${String(
    date.getHours()
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0"
  )}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function formatFileDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("");
}

function statusClassName(status) {
  switch (status) {
    case STATUS.COMPLETED:
      return "completed";
    case STATUS.HOLD:
      return "hold";
    default:
      return "pending";
  }
}

function createUniqueOptions(values) {
  return [...new Set(values)]
    .filter((value) => String(value ?? "").trim() !== "")
    .sort((a, b) =>
      String(a).localeCompare(String(b), "ja", {
        numeric: true,
      })
    );
}

export default App;
