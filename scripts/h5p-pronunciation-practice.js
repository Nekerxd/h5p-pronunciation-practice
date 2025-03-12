var H5P = H5P || {};

H5P.PronunciationPractice = (function ($) {
  function PronunciationPractice(options, id) {
    H5P.Question.call(this, 'pronunciation-practice');

    this.options = $.extend(true, {}, {
      words: [],
      scoreWords: true,
      retry: true,
      behaviour: {
        enableRetry: true,
        enableSolutionsButton: false,
        enableCheckButton: false,
        passPercentage: 75,
      },
      l10n: {
        checkAnswer: "Check",
        showSolution: "Show solution",
        tryAgain: "Retry",
        correct: "Correct!",
        incorrect: "Incorrect!",
        score: "You got @score of @total points",
        listen: "Listen",
        startSpeaking: "Start Speaking",
        next: "Next",
        stopSpeaking: "Stop",
      },
      video: {  // Video options, as before
        sources: [],
      }
    }, options);

    this.id = id;
    this.currentWords = this.options.words || [];
    this.currentWordIndex = 0;
    this.synth = window.speechSynthesis;
    this.recognition = null;
    this.recognizing = false;
    this.score = 0;
    this.maxScore = this.currentWords.length;
    this.answered = false;
    this.attempts = 0;
    this.wordAttempts = [];
    this.isCorrect = false;
    // No need for this.video here; it's handled within buildMedium
  }

  PronunciationPractice.prototype.registerDomElements = function () {
    const $content = $("<div>", { class: "h5p-pronunciation-practice" });

    this.$mediumContainer = $('<div>', {
      'class': 'h5p-pronunciation-practice-medium'
    });
    $content.append(this.$mediumContainer);

    this.medium = this.buildMedium({  
      medium: this.options.mediumGroup.medium,
    });
    this.$mediumContainer.append(this.medium.dom); // Append the *medium's* DOM

    const $wordContainer = $("<div>", { class: "word-container" });
    this.$currentWord = $("<div>", {
      class: "current-word",
      id: "current-word",
    });
    $wordContainer.append(this.$currentWord);
    $content.append($wordContainer);

    const $controls = $("<div>", { class: "controls" });
    this.$listenBtn = $("<button>", {
      id: "listen-btn",
      class: "h5p-button",
      text: this.options.l10n.listen,
      click: () => this.speak(this.currentWords[this.currentWordIndex]),
    });
    this.$startRecordingBtn = $("<button>", {
      id: "start-recording",
      class: "h5p-button",
      text: this.options.l10n.startSpeaking,
      click: () => this.startRecognition(),
    });

    const nextButtonText = this.currentWords.length === 1 ?
      this.options.l10n.checkAnswer :
      this.options.l10n.next;

    this.$nextWordBtn = $("<button>", {
      id: "next-word",
      class: "h5p-button",
      text: nextButtonText,
      click: () => this.nextWord(),
    });

    $controls.append(
      this.$listenBtn,
      this.$startRecordingBtn,
      this.$nextWordBtn
    );
    $content.append($controls);

    this.$recognitionResult = $("<div>", {
      id: "recognition-result",
      class: "recognition-result",
    });
    $content.append(this.$recognitionResult);

    this.setContent($content);

    if (this.options.behaviour.enableCheckButton) {
      this.addButton("check-answer", this.options.l10n.checkAnswer, () => { this.checkAnswer(); }, true, {}, {});
    }
    if (this.options.behaviour.enableSolutionsButton) {
      this.addButton("show-solution", this.options.l10n.showSolution, () => { this.showSolutions(); }, false, {}, {});
    }
    if (this.options.behaviour.enableRetry) {
      this.addButton("try-again", this.options.l10n.tryAgain, () => { this.retry(); }, false, {}, {});
    }

    this.initSpeechRecognition();

    if (this.currentWords.length > 0) {
      this.displayCurrentWord();
    }

    this.wordAttempts = new Array(this.currentWords.length).fill(0);
  };

  PronunciationPractice.prototype.isInstanceTask = function (instance = {}) {
    if (!instance) {
      return false;
    }

    if (instance.isTask) {
      return instance.isTask; // Content will determine if it's task on its own
    }

    // Check for maxScore as indicator for being a task
    return (typeof instance.getMaxScore === 'function');
  }

  PronunciationPractice.prototype.bubbleDown = function (origin, eventName, targets = []) {
    origin.on(eventName, function (event) {
      if (origin.bubblingUpwards) {
        return; // Prevent send event back down.
      }

      targets.forEach((target) => {
        target.trigger(eventName, event);
      });
    });
  }

  PronunciationPractice.prototype.bubbleUp = function (origin, eventName, target) {
    origin.on(eventName, (event) => {

      // Prevent target from sending event back down
      target.bubblingUpwards = true;

      // Trigger event
      target.trigger(eventName, event);

      // Reset
      target.bubblingUpwards = false;
    });
  }

    PronunciationPractice.prototype.buildMedium = function (params = {}) {
    const dom = document.createElement('div');
    dom.classList.add('h5p-transcript-medium');

    // Medium specific overrides
    const machineName = params.medium?.library?.split(' ').shift();
    if (machineName === 'H5P.Audio') {
      params.medium.params.fitToWrapper = true;
      params.medium.params.playerMode = 'full';
    }
    else if (machineName === 'H5P.BigVideo' || machineName === 'H5P.Video') {
      if (
        params.medium.params.sources?.length &&
        params.medium.params.sources[0].mime !== 'video/mp4' &&
        params.medium.params.sources[0].mime !== 'video/webm' &&
        params.medium.params.sources[0].mime !== 'video/ogg'
      ) {
        params.medium.params.visuals.fit = false;
      }

      params.medium.params.visuals.disableFullscreen = true;
    }

    const instance = (!params.medium?.library) ?
      null :
      H5P.newRunnable(
        params.medium,
        this.contentId,
        H5P.jQuery(dom),
        false,
        { previousState: params.previousState }
      );

    if (instance) {
      /*
       * Workaround for bug in H5P.Audio.
       * Chromium based browsers need explicit default height
       */
      if (machineName === 'H5P.Audio' && !!window.chrome) {
        instance.audio.style.height = '54px';
      }
      else if (machineName === 'H5P.BigVideo' || machineName === 'H5P.Video') {
        // Hide fullscreen
        const videoElement = dom.querySelector('video');
        if (videoElement) {
          const controlslist = videoElement.getAttribute('controlsList');
          if (!controlslist.includes('nofullscreen')) {
            videoElement.setAttribute(
              'controlslist',
              `${controlslist} nofullscreen`
            );
          }
        }
      }
      else if (machineName === 'H5P.InteractiveVideo') {
        // Hide fullscreen
        instance.on('controls', () => {
          instance.controls?.$fullscreen?.remove();
        });
      }

      if (this.isInstanceTask(instance)) {
        instance.on('xAPI', (event) => {
          this.trackScoring(event);
        });
      }

      // Resize instance to fit inside parent and vice versa
      this.bubbleDown(this, 'resize', [instance]);
      this.bubbleUp(instance, 'resize', this);
    }
    else {
      dom.classList.add('h5p-transcript-message');
      dom.innerHTML = 'Medium source undefined';
    }

    return {
      dom: dom,
      instance: instance
    };
  }
    PronunciationPractice.prototype.bubbleUp = function (origin, eventName, target) {
        origin.on(eventName, (event) => {
            target.bubblingUpwards = true;
            target.trigger(eventName, event);
            target.bubblingUpwards = false;
        });
    };

  PronunciationPractice.prototype.initSpeechRecognition = function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = "en-US";

      this.recognition.onstart = () => {
        this.recognizing = true;
        this.$startRecordingBtn.prop("disabled", true);
        this.$recognitionResult.text("Listening...");
        this.$recognitionResult.removeClass().addClass("recognition-result");
      };

      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        if (this.currentWords.length > 0) {
          const currentWord = this.currentWords[this.currentWordIndex].toLowerCase();
          this.$recognitionResult.text(`You said: "${transcript}"`);
          this.isCorrect = false;

          if (transcript === currentWord) {
            this.isCorrect = true;
          } else if (this.isNumberWord(currentWord)) {
            this.isCorrect = this.checkNumberMatch(transcript, currentWord);
          } else if (this.getSimilarity(transcript, currentWord) > 0.8) {
            this.isCorrect = true;
          }
          this.wordAttempts[this.currentWordIndex]++;
          this.attempts++;

          if (this.isCorrect) {
            this.$recognitionResult.removeClass().addClass("recognition-result voice-feedback");
          } else {
            this.$recognitionResult.removeClass().addClass("recognition-result voice-feedback");
          }

          if (this.isCorrect && this.options.scoreWords && this.wordAttempts[this.currentWordIndex] === 1) {
            this.score++;
          }

          const xAPIEvent = this.createXAPIEventTemplate("answered");
          this.addQuestionToXAPI(xAPIEvent);
          this.addResponseToXAPI(xAPIEvent, transcript, currentWord);
          this.trigger(xAPIEvent);
          this.trigger("question-answered", this.isCorrect);
        }
      };

      this.recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        this.$recognitionResult.text("Error: " + event.error);
        this.stopRecognition();
      };

      this.recognition.onend = () => {
        this.stopRecognition();
      };
      return true;
    } else {
      this.$recognitionResult.text("Speech recognition not supported. Use Chrome (Android) or Safari (iOS).");
      return false;
    }
  };

  PronunciationPractice.prototype.startRecognition = function () {
    if (this.recognition && !this.recognizing) {
      this.recognition.start();
    }
  };

  PronunciationPractice.prototype.stopRecognition = function () {
    if (this.recognizing) {
      this.recognition.stop();
      this.recognizing = false;
      this.$startRecordingBtn.prop("disabled", false);
    }
  };
   PronunciationPractice.prototype.isNumberWord = function (word) {
    const numberWords = [
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
      "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion",
    ];

    if (/\d/.test(word)) return true;

    const wordParts = word.split(/[-\s]/);
    return wordParts.some((part) => numberWords.includes(part));
  };

  PronunciationPractice.prototype.checkNumberMatch = function (said, target) {
    function textToNumber(text) {
      text = text.replace(/\band\b|\ba\b|\ban\b/gi, "").trim();

      const numWords = {
        zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
        twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
      };

      if (/^\d+$/.test(text)) return parseInt(text);

      if (text.includes(" ")) {
        const parts = text.split(" ");
        let total = 0;
        let current = 0;

        for (let i = 0; i < parts.length; i++) {
          let word = parts[i].toLowerCase();

          if (word.includes("-")) {
            const hyphenParts = word.split("-");
            if (numWords[hyphenParts[0]] && numWords[hyphenParts[1]]) {
              current += numWords[hyphenParts[0]] + numWords[hyphenParts[1]];
              continue;
            }
          }

          if (word === "hundred") {
            current = current * 100 || 100;
            continue;
          }
          if (word === "thousand") {
            current = current * 1000 || 1000;
            total += current;
            current = 0;
            continue;
          }

          if (numWords[word] !== undefined) {
            current += numWords[word];
          }
        }

        return total + current;
      }

      if (text.includes("-")) {
        const parts = text.split("-");
        if (numWords[parts[0]] && numWords[parts[1]]) {
          return numWords[parts[0]] + numWords[parts[1]];
        }
      }

      return numWords[text] || null;
    }

    const saidNum = textToNumber(said);
    const targetNum = textToNumber(target);

    if (saidNum !== null && targetNum !== null) {
      return saidNum === targetNum;
    }

    const saidDigits = said.match(/\d+/);
    if (saidDigits) {
      const extractedNumber = parseInt(saidDigits[0]);
      if (target.includes("hundred") || target.includes("thousand")) {
        return textToNumber(target) === extractedNumber;
      }
    }

    return false;
  };

  PronunciationPractice.prototype.getSimilarity = function (str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= shorter.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[shorter.length] = lastValue;
    }
    return (longer.length - costs[shorter.length]) / longer.length;
  };

  PronunciationPractice.prototype.speak = function (text) {
    if (this.synth.speaking) {
      this.synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.8;
    this.synth.speak(utterance);
  };

  PronunciationPractice.prototype.displayCurrentWord = function () {
    if (this.currentWords.length > 0) {
      this.$currentWord.text(this.currentWords[this.currentWordIndex]);

      if (this.currentWords.length === 1 || this.currentWordIndex === this.currentWords.length - 1) {
        this.$nextWordBtn.text(this.options.l10n.checkAnswer);
      } else {
        this.$nextWordBtn.text(this.options.l10n.next);
      }
    } else {
      this.$currentWord.text("");
    }
    this.$recognitionResult.text("");
    this.$recognitionResult.removeClass().addClass("recognition-result");
  };


  PronunciationPractice.prototype.nextWord = function () {
    if (this.currentWords.length > 0) {
      if (this.currentWordIndex === this.currentWords.length - 1 || this.currentWords.length === 1) {
        if (this.options.scoreWords) {
          this.showScoreSummary();
        }

        if (this.currentWords.length > 1) {
          this.currentWordIndex = 0;
          this.displayCurrentWord();
        }
        return;
      }
      this.currentWordIndex++;
      this.displayCurrentWord();
    }
  };

  PronunciationPractice.prototype.showScoreSummary = function () {
    const scorePercent = (this.score / this.maxScore) * 100;
    const passPercentage = this.options.behaviour.passPercentage || 75;
    const passed = scorePercent >= passPercentage;

    this.setFeedback(this.options.l10n.score.replace("@score", this.score).replace("@total", this.maxScore),this.score,this.maxScore);

    const xAPIEvent = this.createXAPIEventTemplate("completed");
    xAPIEvent.data.statement.result = {
      completion: true,
      success: passed,
      score: {
        min: 0,
        max: this.maxScore,
        raw: this.score,
        scaled: this.score / this.maxScore,
      },
    };
    this.trigger(xAPIEvent);
  };

  PronunciationPractice.prototype.checkAnswer = function () {
    this.hideButton("check-answer");
    if (this.isCorrect) {
      this.showButton("show-solution");
      if (this.options.behaviour.enableRetry) {
        this.showButton("try-again");
      }
    }
    this.trigger("resize");
  };

  PronunciationPractice.prototype.showSolutions = function () {
    this.$recognitionResult.text(`Correct: "${this.currentWords[this.currentWordIndex]}"`);
    this.speak(this.currentWords[this.currentWordIndex]);
    this.trigger("resize");
  };

  PronunciationPractice.prototype.resetTask = function () {
    this.score = 0;
    this.currentWordIndex = 0;
    this.wordAttempts = new Array(this.currentWords.length).fill(0);
    this.displayCurrentWord();
    this.hideButton("show-solution");
    this.hideButton("try-again");
    this.showButton("check-answer");
    this.removeFeedback();
    // Reset the video using the instance
    if (this.medium && this.medium.instance && typeof this.medium.instance.resetTask === 'function') {
        this.medium.instance.resetTask();
    }

    this.trigger("resize");
  };

  PronunciationPractice.prototype.retry = function () {
    this.hideButton("show-solution");
    this.hideButton("try-again");
    this.showButton("check-answer");
    this.$recognitionResult.text("");
    this.$recognitionResult.removeClass().addClass("recognition-result");
    this.trigger("resize");
  };
  PronunciationPractice.prototype.getScore = function () {
    return this.score;
  };
  PronunciationPractice.prototype.getMaxScore = function () {
    return this.maxScore;
  };
  PronunciationPractice.prototype.getAnswerGiven = function () {
    return this.wordAttempts[this.currentWordIndex] > 0;
  };
  PronunciationPractice.prototype.getXAPIData = function () {
    const xAPIEvent = this.createXAPIEventTemplate("answered");
    this.addQuestionToXAPI(xAPIEvent);
    this.addResponseToXAPI(xAPIEvent, "");
    return {
      statement: xAPIEvent.data.statement,
    };
  };

  PronunciationPractice.prototype.addQuestionToXAPI = function (xAPIEvent) {
    const definition = xAPIEvent.getVerifiedStatementValue(["object","definition"]);
    definition.description = {"en-US": this.currentWords[this.currentWordIndex]};
    definition.type = "http://adlnet.gov/expapi/activities/cmi.interaction";
    definition.interactionType = "fill-in";
    definition.correctResponsesPattern = [this.currentWords[this.currentWordIndex]];
  };

  PronunciationPractice.prototype.addResponseToXAPI = function (xAPIEvent, userResponse, correctResponse) {
    const isCorrect = this.isCorrect;
    xAPIEvent.setScoredResult(this.score, this.maxScore, this, true, isCorrect);
    xAPIEvent.data.statement.result.response = userResponse;
  };

  return PronunciationPractice;
})(H5P.jQuery, H5P.Question);